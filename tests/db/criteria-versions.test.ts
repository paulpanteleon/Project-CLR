import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for screening criteria versions (US-02, US-12, FR-DR-02, FR-DR-06, ADR-0013).
// They run the real migrations against PGlite, with the Supabase stand-in from
// supabase-shim.sql. Each test signs in as a user the same way Supabase does.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only

const VERSION_1 = "30000000-0000-0000-0000-000000000001";
const VERSION_2 = "30000000-0000-0000-0000-000000000002";
const VERSION_3 = "30000000-0000-0000-0000-000000000003";
const REVIEW = "AI in clinical literature review";

const REASONS = [
  { code: "R-TOPIC-OK", label: "Describes AI applied to clinical literature review." },
  { code: "R-TOPIC-OUT", label: "Does not describe AI applied to clinical literature review." },
];

let db: PGlite;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

// Calls create_criteria_version with the same arguments the app sends.
function draft(id: string, overrides: Partial<Record<string, string>> = {}, reasons = REASONS) {
  const fields = {
    review_name: REVIEW,
    review_topic: "Clinical literature review that uses AI.",
    population: "Adults in clinical literature reviews",
    intervention: "AI or automation for screening",
    comparator: "Manual screening",
    outcomes: "Screening accuracy and time",
    design: "Primary studies and reviews",
    dates: "2018 onwards",
    ...overrides,
  };
  return db.query<{ r: string }>(
    "select public.create_criteria_version($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) as r",
    [
      id,
      fields.review_name,
      fields.review_topic,
      fields.population,
      fields.intervention,
      fields.comparator,
      fields.outcomes,
      fields.design,
      fields.dates,
      JSON.stringify(reasons),
    ],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  for (const sql of migrations) {
    await db.exec(sql);
  }
  await db.exec(`
    insert into auth.users (id) values ('${OWNER}'), ('${WRITER}'), ('${READER}');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("create_criteria_version", () => {
  it("lets a medical writer draft a version with its reasons", async () => {
    const result = await asUser(WRITER, () => draft(VERSION_1));
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{ status: string; version_number: number; drafted_by: string }>(
      "select status, version_number, drafted_by from public.criteria_versions where id = $1",
      [VERSION_1],
    );
    expect(rows[0]).toEqual({ status: "draft", version_number: 1, drafted_by: WRITER });

    const reasons = await db.query("select code from public.criteria_reasons where criteria_version_id = $1", [
      VERSION_1,
    ]);
    expect(reasons.rows).toHaveLength(2);
  });

  it("numbers the next version of the same review", async () => {
    const result = await asUser(WRITER, () => draft(VERSION_2));
    expect(result.rows[0].r).toBe("ok");
    const { rows } = await db.query<{ version_number: number }>(
      "select version_number from public.criteria_versions where id = $1",
      [VERSION_2],
    );
    expect(rows[0].version_number).toBe(2);
  });

  it("is refused for a clinician reviewer, and the attempt is audited", async () => {
    const result = await asUser(READER, () => draft(VERSION_3));
    expect(result.rows[0].r).toBe("denied");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'criteria.draft'",
      [READER],
    );
    expect(audit.rows.some((row) => row.allowed === false)).toBe(true);
  });

  it("refuses a version with no reasons", async () => {
    await expect(
      asUser(WRITER, () => draft(VERSION_3, {}, [])),
    ).rejects.toThrow(/at least one reason/);
  });

  it("refuses a blank criteria field", async () => {
    await expect(
      asUser(WRITER, () => draft(VERSION_3, { population: "   " })),
    ).rejects.toThrow(/check constraint|violates/);
  });

  it("refuses a reason code that is not upper case", async () => {
    await expect(
      asUser(WRITER, () => draft(VERSION_3, {}, [{ code: "r-topic", label: "Bad code." }])),
    ).rejects.toThrow(/check constraint|violates/);
  });
});

describe("who can see a draft", () => {
  it("shows a draft only to its drafter and to clinical affairs leads", async () => {
    const reader = await asUser(READER, () =>
      db.query("select id from public.criteria_versions where id = $1", [VERSION_1]),
    );
    expect(reader.rows).toHaveLength(0);

    const writer = await asUser(WRITER, () =>
      db.query("select id from public.criteria_versions where id = $1", [VERSION_1]),
    );
    expect(writer.rows).toHaveLength(1);

    const owner = await asUser(OWNER, () =>
      db.query("select id from public.criteria_versions where id = $1", [VERSION_1]),
    );
    expect(owner.rows).toHaveLength(1);
  });
});

describe("approve_criteria_version", () => {
  it("refuses the drafter approving their own draft", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.approve_criteria_version($1) as r", [VERSION_1]),
    );
    expect(result.rows[0].r).toBe("own_draft");
  });

  it("refuses a user who is not a clinical affairs lead", async () => {
    const result = await asUser(READER, () =>
      db.query<{ r: string }>("select public.approve_criteria_version($1) as r", [VERSION_1]),
    );
    expect(result.rows[0].r).toBe("denied");
  });

  it("lets a clinical affairs lead approve a draft, and audits it", async () => {
    const result = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.approve_criteria_version($1) as r", [VERSION_1]),
    );
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{ status: string; approved_by: string }>(
      "select status, approved_by from public.criteria_versions where id = $1",
      [VERSION_1],
    );
    expect(rows[0]).toEqual({ status: "approved", approved_by: OWNER });

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'criteria.approve' and target = $2",
      [OWNER, VERSION_1],
    );
    expect(audit.rows).toEqual([{ allowed: true }]);
  });

  it("refuses to approve a version that is no longer a draft", async () => {
    const result = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.approve_criteria_version($1) as r", [VERSION_1]),
    );
    expect(result.rows[0].r).toBe("not_draft");
  });

  it("lets everyone with a role read an approved version", async () => {
    const reader = await asUser(READER, () =>
      db.query("select id from public.criteria_versions where id = $1", [VERSION_1]),
    );
    expect(reader.rows).toHaveLength(1);

    const reasons = await asUser(READER, () =>
      db.query("select code from public.criteria_reasons where criteria_version_id = $1", [VERSION_1]),
    );
    expect(reasons.rows).toHaveLength(2);
  });
});

describe("an approved version is locked in its text", () => {
  // These run as the database owner, so row-level security does not apply.
  // The triggers still do, which is what is being tested.

  it("refuses a change to the text of an approved version", async () => {
    await expect(
      db.query("update public.criteria_versions set population = 'Changed' where id = $1", [VERSION_1]),
    ).rejects.toThrow(/cannot change/);
  });

  it("refuses moving an approved version back to draft", async () => {
    await expect(
      db.query("update public.criteria_versions set status = 'draft', approved_by = null, approved_at = null where id = $1", [
        VERSION_1,
      ]),
    ).rejects.toThrow(/cannot move from approved to draft|cannot change/);
  });

  it("refuses a change to who approved a version", async () => {
    await expect(
      db.query("update public.criteria_versions set approved_by = $2 where id = $1", [VERSION_1, WRITER]),
    ).rejects.toThrow(/cannot change/);
  });

  it("refuses a reason added to an approved version", async () => {
    await expect(
      db.query(
        "insert into public.criteria_reasons (criteria_version_id, code, label) values ($1, 'R-LATE', 'Late reason.')",
        [VERSION_1],
      ),
    ).rejects.toThrow(/no longer a draft/);
  });

  it("refuses a change to or removal of a reason", async () => {
    await expect(
      db.query("update public.criteria_reasons set label = 'Changed.' where criteria_version_id = $1", [VERSION_1]),
    ).rejects.toThrow(/cannot be changed or deleted/);
    await expect(
      db.query("delete from public.criteria_reasons where criteria_version_id = $1", [VERSION_1]),
    ).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("refuses deleting a version", async () => {
    await expect(db.query("delete from public.criteria_versions where id = $1", [VERSION_1])).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("refuses a version approved by its own drafter", async () => {
    await expect(
      db.query(
        `insert into public.criteria_versions (
           id, review_name, version_number, review_topic, population, intervention,
           comparator, outcomes, design, dates, status, drafted_by, approved_by, approved_at
         ) values ($1, 'Self approved review', 1, 't', 'p', 'i', 'c', 'o', 'd', 'dt',
           'approved', $2, $2, now())`,
        ["30000000-0000-0000-0000-0000000000f1", WRITER],
      ),
    ).rejects.toThrow(/criteria_drafter_cannot_approve/);
  });

  it("refuses a direct update by a signed-in user", async () => {
    await expect(
      asUser(OWNER, () =>
        db.query("update public.criteria_versions set status = 'approved' where id = $1", [VERSION_2]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("lock_criteria_version", () => {
  it("refuses to lock a draft", async () => {
    const result = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.lock_criteria_version($1) as r", [VERSION_2]),
    );
    expect(result.rows[0].r).toBe("not_approved");
  });

  it("lets a clinical affairs lead lock an approved version, once", async () => {
    const approved = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.approve_criteria_version($1) as r", [VERSION_2]),
    );
    expect(approved.rows[0].r).toBe("ok");

    const first = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.lock_criteria_version($1) as r", [VERSION_2]),
    );
    expect(first.rows[0].r).toBe("ok");

    const second = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.lock_criteria_version($1) as r", [VERSION_2]),
    );
    expect(second.rows[0].r).toBe("already_locked");
  });

  it("refuses locking by a user who is not a clinical affairs lead", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.lock_criteria_version($1) as r", [VERSION_1]),
    );
    expect(result.rows[0].r).toBe("denied");
  });
});
