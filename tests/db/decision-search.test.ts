import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for find_decisions, decision_reviewers and batch_people (ADR-0019). They run the real
// migrations against PGlite, with the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer, created both batches
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only, member of batch A only
const OUTSIDER = "00000000-0000-0000-0000-00000000000d"; // medical writer, reviewer, created batch C
const BATCH_A = "10000000-0000-0000-0000-000000000001";
const BATCH_B = "10000000-0000-0000-0000-000000000002";
const BATCH_C = "10000000-0000-0000-0000-000000000003";
const VERSION = "50000000-0000-0000-0000-00000000000a";
const PMID_1 = "70000001";
const PMID_2 = "70000002";
const PMID_3 = "70000003";
const PMID_4 = "70000004";
const PMID_5 = "70000005";

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

type Filters = {
  query?: string;
  batchId?: string;
  outcome?: string;
  reviewerId?: string;
  reasonCode?: string;
};

type Row = {
  batch_id: string;
  pmid: string;
  outcome: string | null;
  reason_code: string | null;
  reason_label: string | null;
  decided_by: string | null;
  corrections: number;
};

async function find(userId: string, filters: Filters = {}) {
  const { rows } = await asUser(userId, () =>
    db.query<Row>(
      `select batch_id, pmid, outcome, reason_code, reason_label, decided_by, corrections
       from public.find_decisions($1, $2, $3, $4, $5)`,
      [
        filters.query ?? null,
        filters.batchId ?? null,
        filters.outcome ?? null,
        filters.reviewerId ?? null,
        filters.reasonCode ?? null,
      ],
    ),
  );
  return rows;
}

function pmids(rows: Row[]) {
  return rows.map((row) => row.pmid).sort();
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  for (const sql of migrations) {
    await db.exec(sql);
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'lead@example.com'), ('${WRITER}', 'writer@example.com'),
      ('${READER}', 'reader@example.com'), ('${OUTSIDER}', 'outsider@example.com');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH_A}', 'Batch A', 'public', '${WRITER}'),
      ('${BATCH_B}', 'Batch B', 'public', '${WRITER}'),
      ('${BATCH_C}', 'Batch C', 'public', '${OUTSIDER}');
    insert into public.batch_members (batch_id, user_id) values ('${BATCH_A}', '${READER}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by) values
      ('40000000-0000-0000-0000-000000000001', '${BATCH_A}', 'a.txt', 'PMID- 1', '${"a".repeat(64)}', '${WRITER}'),
      ('40000000-0000-0000-0000-000000000002', '${BATCH_B}', 'b.txt', 'PMID- 2', '${"b".repeat(64)}', '${WRITER}'),
      ('40000000-0000-0000-0000-000000000003', '${BATCH_C}', 'c.txt', 'PMID- 3', '${"c".repeat(64)}', '${OUTSIDER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, authors, abstract) values
      ('${BATCH_A}', '40000000-0000-0000-0000-000000000001', '${PMID_1}', 'Machine learning for screening', 'Smith J; Jones K', 'A.'),
      ('${BATCH_A}', '40000000-0000-0000-0000-000000000001', '${PMID_2}', 'Dental restorations', 'Garcia M', 'B.'),
      ('${BATCH_A}', '40000000-0000-0000-0000-000000000001', '${PMID_3}', 'Sleep apnoea wearables', 'Chiang A', null),
      ('${BATCH_B}', '40000000-0000-0000-0000-000000000002', '${PMID_4}', 'Screening 100% of records', 'Smith J', 'C.'),
      ('${BATCH_C}', '40000000-0000-0000-0000-000000000003', '${PMID_5}', 'Machine learning elsewhere', 'Smith J', 'D.');
  `);

  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Search review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION]));
  for (const batch of [BATCH_A, BATCH_B]) {
    await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [batch, VERSION]));
  }
  await asUser(OUTSIDER, () => db.query("select public.set_batch_criteria($1, $2)", [BATCH_C, VERSION]));

  // Batch A: record 1 included, then corrected to excluded. Record 2 included. Record 3 undecided.
  // Batch B: record 4 included. Batch C (the outsider's own): record 5 excluded.
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'On topic.')", [BATCH_A, PMID_1]),
  );
  const { rows } = await db.query<{ id: string }>(
    "select id from public.decision_events where batch_id = $1 and record_pmid = $2",
    [BATCH_A, PMID_1],
  );
  await asUser(WRITER, () =>
    db.query("select public.correct_screening_decision($1, 'exclude', 'R-TOPIC-OUT', 'Off topic on a second read.')", [
      rows[0].id,
    ]),
  );
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'Matches.')", [BATCH_A, PMID_2]),
  );
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'Matches.')", [BATCH_B, PMID_4]),
  );
  await asUser(OUTSIDER, () =>
    db.query("select public.record_screening_decision($1, $2, 'exclude', 'R-TOPIC-OUT', 'Off topic.')", [BATCH_C, PMID_5]),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("find_decisions", () => {
  it("returns every record in the caller's batches and none from others", async () => {
    expect(pmids(await find(WRITER))).toEqual([PMID_1, PMID_2, PMID_3, PMID_4]);
    expect(pmids(await find(READER))).toEqual([PMID_1, PMID_2, PMID_3]);
    expect(pmids(await find(OUTSIDER))).toEqual([PMID_5]);
  });

  it("returns nothing to someone signed in without a role", async () => {
    await db.exec("insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'norole@example.com')");
    expect(await find("00000000-0000-0000-0000-00000000000e")).toEqual([]);
  });

  it("finds a record by its exact PubMed ID, not by part of one", async () => {
    expect(pmids(await find(WRITER, { query: PMID_2 }))).toEqual([PMID_2]);
    expect(await find(WRITER, { query: "7000000" })).toEqual([]);
  });

  it("finds records by part of the title or an author, in any case", async () => {
    expect(pmids(await find(WRITER, { query: "SCREENING" }))).toEqual([PMID_1, PMID_4]);
    expect(pmids(await find(WRITER, { query: "garcia" }))).toEqual([PMID_2]);
    expect(pmids(await find(WRITER, { query: "  smith j  " }))).toEqual([PMID_1, PMID_4]);
  });

  it("treats % and _ in the search as plain characters", async () => {
    expect(pmids(await find(WRITER, { query: "100%" }))).toEqual([PMID_4]);
    expect(await find(WRITER, { query: "%" })).toHaveLength(1);
    expect(await find(WRITER, { query: "_" })).toEqual([]);
  });

  it("shows the current outcome after a correction, with its reason, reviewer and correction count", async () => {
    const [row] = await find(READER, { query: PMID_1 });
    expect(row).toMatchObject({
      batch_id: BATCH_A,
      outcome: "exclude",
      reason_code: "R-TOPIC-OUT",
      reason_label: "Does not describe the topic.",
      decided_by: "writer@example.com",
      corrections: 1,
    });
  });

  it("filters by outcome, including records with no decision yet", async () => {
    expect(pmids(await find(WRITER, { outcome: "include" }))).toEqual([PMID_2, PMID_4]);
    expect(pmids(await find(WRITER, { outcome: "exclude" }))).toEqual([PMID_1]);
    const undecided = await find(WRITER, { outcome: "undecided" });
    expect(undecided).toEqual([
      expect.objectContaining({ pmid: PMID_3, outcome: null, decided_by: null, corrections: 0 }),
    ]);
  });

  it("filters by batch, reviewer and reason code", async () => {
    expect(pmids(await find(WRITER, { batchId: BATCH_B }))).toEqual([PMID_4]);
    expect(pmids(await find(WRITER, { reviewerId: WRITER }))).toEqual([PMID_1, PMID_2, PMID_4]);
    expect(await find(WRITER, { reviewerId: OUTSIDER })).toEqual([]);
    expect(pmids(await find(WRITER, { reasonCode: "R-TOPIC-OUT" }))).toEqual([PMID_1]);
  });

  it("combines filters", async () => {
    expect(pmids(await find(WRITER, { query: "smith", outcome: "include" }))).toEqual([PMID_4]);
  });

  it("does not reach another person's batch through the batch filter", async () => {
    expect(await find(WRITER, { batchId: BATCH_C })).toEqual([]);
  });

  it("puts the newest decisions first and undecided records last", async () => {
    const rows = await find(WRITER);
    expect(rows.at(-1)?.pmid).toBe(PMID_3);
    expect(rows[0].pmid).toBe(PMID_4);
  });

  it("caps the number of rows", async () => {
    const { rows } = await asUser(WRITER, () =>
      db.query<Row>("select pmid from public.find_decisions(p_limit => 2)"),
    );
    expect(rows).toHaveLength(2);
  });

  it("is not available to the anon role", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.find_decisions()")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("decision_reviewers", () => {
  it("lists the people who decided records in the caller's batches", async () => {
    const reviewers = (who: string) =>
      asUser(who, () => db.query<{ email: string }>("select email from public.decision_reviewers()")).then((result) =>
        result.rows.map((row) => row.email),
      );
    expect(await reviewers(READER)).toEqual(["writer@example.com"]);
    expect(await reviewers(OUTSIDER)).toEqual(["outsider@example.com"]);
  });
});

describe("batch_people", () => {
  it("gives members the emails of everyone in the batch's history", async () => {
    const { rows } = await asUser(READER, () =>
      db.query<{ user_id: string; email: string }>("select user_id, email from public.batch_people($1)", [BATCH_A]),
    );
    expect(rows).toEqual([
      { user_id: READER, email: "reader@example.com" },
      { user_id: WRITER, email: "writer@example.com" },
    ]);
  });

  it("returns nothing to someone who is not a member", async () => {
    const { rows } = await asUser(OUTSIDER, () => db.query("select * from public.batch_people($1)", [BATCH_A]));
    expect(rows).toEqual([]);
  });
});
