import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for screening decisions, corrections and the batch's criteria version (US-04, US-05,
// US-10, US-11, FR-DR-01, FR-DR-02, FR-DR-04, FR-DR-06, ADR-0014). They run the real migrations
// against PGlite, with the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer, batch member
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only, batch member
const OUTSIDER = "00000000-0000-0000-0000-00000000000d"; // medical writer, reviewer, not a member

const BATCH = "10000000-0000-0000-0000-000000000001";
const BATCH_NO_CRITERIA = "10000000-0000-0000-0000-000000000002";
const SNAPSHOT = "40000000-0000-0000-0000-000000000001";
const VERSION_APPROVED = "50000000-0000-0000-0000-00000000000a";
const VERSION_DRAFT = "50000000-0000-0000-0000-00000000000b";
const PMID_1 = "70000001";
const PMID_2 = "70000002";
const PMID_UNKNOWN = "79999999";
const CHECKSUM = "a".repeat(64);

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

function decide(userId: string, batchId: string, pmid: string, outcome: string, reason: string | null, text = "") {
  return asUser(userId, () =>
    db.query<{ r: string }>("select public.record_screening_decision($1, $2, $3, $4, $5) as r", [
      batchId,
      pmid,
      outcome,
      reason,
      text,
    ]),
  );
}

function correct(userId: string, eventId: string, outcome: string, reason: string, text: string) {
  return asUser(userId, () =>
    db.query<{ r: string }>("select public.correct_screening_decision($1, $2, $3, $4) as r", [
      eventId,
      outcome,
      reason,
      text,
    ]),
  );
}

// The latest decision or correction for a record, read as the database owner.
async function latestEventId(batchId: string, pmid: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.decision_events
     where batch_id = $1 and record_pmid = $2 and kind in ('human_decision', 'correction')
     order by recorded_at desc, id desc limit 1`,
    [batchId, pmid],
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  for (const sql of migrations) {
    await db.exec(sql);
  }
  await db.exec(`
    insert into auth.users (id) values ('${OWNER}'), ('${WRITER}'), ('${READER}'), ('${OUTSIDER}');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Screening batch', 'public', '${OWNER}'),
      ('${BATCH_NO_CRITERIA}', 'Batch without criteria', 'public', '${OWNER}');
    insert into public.batch_members (batch_id, user_id) values
      ('${BATCH}', '${WRITER}'), ('${BATCH}', '${READER}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by)
      values ('${SNAPSHOT}', '${BATCH}', 'export.txt', 'PMID- 70000001', '${CHECKSUM}', '${OWNER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract) values
      ('${BATCH}', '${SNAPSHOT}', '${PMID_1}', 'First record', 'An abstract.'),
      ('${BATCH}', '${SNAPSHOT}', '${PMID_2}', 'Second record', 'Another abstract.');
  `);

  // The criteria: one approved version (drafted by the writer, approved by the lead), one draft.
  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Screening review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION_APPROVED, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION_APPROVED]));
  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Second review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION_DRAFT, JSON.stringify([{ code: "R-TOPIC-OK", label: "Describes the topic." }])],
    ),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("set_batch_criteria", () => {
  it("refuses a draft version", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.set_batch_criteria($1, $2) as r", [BATCH, VERSION_DRAFT]),
    );
    expect(result.rows[0].r).toBe("not_approved");
  });

  it("refuses a read-only member, and audits it", async () => {
    const result = await asUser(READER, () =>
      db.query<{ r: string }>("select public.set_batch_criteria($1, $2) as r", [BATCH, VERSION_APPROVED]),
    );
    expect(result.rows[0].r).toBe("denied");
  });

  it("sets an approved version on the batch", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.set_batch_criteria($1, $2) as r", [BATCH, VERSION_APPROVED]),
    );
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{ criteria_version_id: string }>(
      "select criteria_version_id from public.batches where id = $1",
      [BATCH],
    );
    expect(rows[0].criteria_version_id).toBe(VERSION_APPROVED);
  });
});

describe("record_screening_decision", () => {
  it("records a decision against the batch's version, and locks that version", async () => {
    const result = await decide(WRITER, BATCH, PMID_1, "include", "R-TOPIC-OK", "Matches the topic.");
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{ criteria_version_id: string; actor_id: string; kind: string }>(
      "select criteria_version_id, actor_id, kind from public.decision_events where batch_id = $1 and record_pmid = $2",
      [BATCH, PMID_1],
    );
    expect(rows[0]).toEqual({ criteria_version_id: VERSION_APPROVED, actor_id: WRITER, kind: "human_decision" });

    const version = await db.query<{ status: string }>(
      "select status from public.criteria_versions where id = $1",
      [VERSION_APPROVED],
    );
    expect(version.rows[0].status).toBe("locked");
  });

  it("refuses a read-only member, and audits it", async () => {
    const result = await decide(READER, BATCH, PMID_2, "exclude", "R-TOPIC-OUT");
    expect(result.rows[0].r).toBe("denied");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'screening.decide'",
      [READER],
    );
    expect(audit.rows).toEqual([{ allowed: false }]);
  });

  it("refuses someone who is not a member of the batch", async () => {
    const result = await decide(OUTSIDER, BATCH, PMID_2, "include", "R-TOPIC-OK");
    expect(result.rows[0].r).toBe("denied");
  });

  it("refuses a record that is not in the batch", async () => {
    const result = await decide(WRITER, BATCH, PMID_UNKNOWN, "include", "R-TOPIC-OK");
    expect(result.rows[0].r).toBe("not_in_batch");
  });

  it("refuses a batch with no criteria version", async () => {
    const result = await decide(OUTSIDER, BATCH_NO_CRITERIA, PMID_1, "include", "R-TOPIC-OK");
    expect(result.rows[0].r).toBe("denied");

    const owner = await decide(OWNER, BATCH_NO_CRITERIA, PMID_1, "include", "R-TOPIC-OK");
    expect(owner.rows[0].r).toBe("no_criteria");
  });

  it("refuses a reason that is not in the batch's criteria version", async () => {
    await expect(decide(WRITER, BATCH, PMID_2, "include", "R-MADE-UP")).rejects.toThrow(
      /decision_reason_from_version/,
    );
  });

  it("refuses a decision without a reason", async () => {
    await expect(decide(WRITER, BATCH, PMID_2, "include", null)).rejects.toThrow(/Choose a reason/);
  });

  it("refuses an outcome that is not one of the four", async () => {
    await expect(decide(WRITER, BATCH, PMID_2, "maybe-ish", "R-TOPIC-OK")).rejects.toThrow(/Choose include/);
  });

  it("refuses a direct insert with no criteria version", async () => {
    await expect(
      asUser(WRITER, () =>
        db.query(
          `insert into public.decision_events (batch_id, record_pmid, kind, outcome, reason_code, actor_id)
           values ($1, $2, 'human_decision', 'include', 'R-TOPIC-OK', $3)`,
          [BATCH, PMID_2, WRITER],
        ),
      ),
    ).rejects.toThrow(/decision_version_required/);
  });
});

describe("correct_screening_decision", () => {
  it("refuses a correction without a reason", async () => {
    const eventId = await latestEventId(BATCH, PMID_1);
    await expect(correct(WRITER, eventId, "exclude", "R-TOPIC-OUT", "  ")).rejects.toThrow(/needs a reason/);
  });

  it("refuses a correction from a read-only member, and audits it", async () => {
    const eventId = await latestEventId(BATCH, PMID_1);
    const result = await correct(READER, eventId, "exclude", "R-TOPIC-OUT", "Not on topic after all.");
    expect(result.rows[0].r).toBe("denied");
  });

  it("adds a correction that becomes the current outcome, and keeps the original", async () => {
    const original = await latestEventId(BATCH, PMID_1);
    const result = await correct(WRITER, original, "exclude", "R-TOPIC-OUT", "Not on topic after all.");
    expect(result.rows[0].r).toBe("ok");

    const current = await asUser(READER, () =>
      db.query<{ outcome: string; kind: string; corrects: string | null }>(
        `select c.outcome, c.kind, e.corrects_event_id as corrects
         from public.current_screening_outcomes c
         join public.decision_events e on e.id = c.event_id
         where c.batch_id = $1 and c.record_pmid = $2`,
        [BATCH, PMID_1],
      ),
    );
    expect(current.rows).toEqual([{ outcome: "exclude", kind: "correction", corrects: original }]);

    const history = await db.query("select id from public.decision_events where batch_id = $1 and record_pmid = $2", [
      BATCH,
      PMID_1,
    ]);
    expect(history.rows).toHaveLength(2);
  });

  it("refuses to correct an event that has already been corrected", async () => {
    const original = await db.query<{ id: string }>(
      "select id from public.decision_events where batch_id = $1 and record_pmid = $2 and kind = 'human_decision'",
      [BATCH, PMID_1],
    );
    const result = await correct(WRITER, original.rows[0].id, "include", "R-TOPIC-OK", "Trying again.");
    expect(result.rows[0].r).toBe("superseded");
  });

  it("allows only one correction per event, even when written directly", async () => {
    const original = await db.query<{ id: string }>(
      "select id from public.decision_events where batch_id = $1 and record_pmid = $2 and kind = 'human_decision'",
      [BATCH, PMID_1],
    );
    await expect(
      db.query(
        `insert into public.decision_events
           (batch_id, record_pmid, kind, outcome, reason_code, criteria_version_id, corrects_event_id, actor_id)
         values ($1, $2, 'correction', 'include', 'R-TOPIC-OK', $3, $4, $5)`,
        [BATCH, PMID_1, VERSION_APPROVED, original.rows[0].id, WRITER],
      ),
    ).rejects.toThrow(/decision_events_one_correction/);
  });

  it("keeps decisions append-only", async () => {
    await expect(db.query("update public.decision_events set outcome = 'include' where batch_id = $1", [BATCH])).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query("delete from public.decision_events where batch_id = $1", [BATCH])).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("the batch's criteria version after decisions exist", () => {
  it("refuses to change the batch's criteria version once a decision exists", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.set_batch_criteria($1, $2) as r", [BATCH, VERSION_DRAFT]),
    );
    expect(result.rows[0].r).toBe("has_decisions");
  });
});
