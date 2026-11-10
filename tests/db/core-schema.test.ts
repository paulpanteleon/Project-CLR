import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// These tests run the real migrations against PGlite (PostgreSQL in Node), with a
// stand-in for Supabase's auth schema (see supabase-shim.sql). Each test signs in
// as a user by setting the same claim Supabase sets, then switches to the
// "authenticated" role, so row-level security applies exactly as it would in production.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
// Every migration, in filename order (the filenames start with a timestamp).
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a";
const WRITER = "00000000-0000-0000-0000-00000000000b";
const READER = "00000000-0000-0000-0000-00000000000c";
const OUTSIDER = "00000000-0000-0000-0000-00000000000d";
const BATCH = "10000000-0000-0000-0000-000000000001";
const OTHER_BATCH = "10000000-0000-0000-0000-000000000002";
const OTHER_EVENT = "20000000-0000-0000-0000-000000000002";
// Decisions must name a criteria version and a reason from it (ADR-0014).
const CRITERIA = "50000000-0000-0000-0000-000000000001";

const RLS_OR_PRIVILEGE = /row-level security|permission denied/;
const APPEND_ONLY = /append-only/;

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

async function insertDecision(
  userId: string,
  fields: Partial<{
    kind: string;
    outcome: string | null;
    reason_code: string | null;
    corrects_event_id: string | null;
    actor_id: string;
  }> = {},
) {
  const row = {
    kind: "human_decision",
    outcome: "include",
    reason_code: "R-TOPIC-OK",
    corrects_event_id: null,
    ...fields,
  };
  return asUser(userId, () =>
    db.query<{ id: string }>(
      `insert into public.decision_events
         (batch_id, record_pmid, kind, outcome, reason_code, criteria_version_id,
          corrects_event_id, actor_id)
       values ($1, '41435444', $2, $3, $4, '${CRITERIA}', $5, coalesce($6, auth.uid()))
       returning id`,
      [BATCH, row.kind, row.outcome, row.reason_code, row.corrects_event_id, row.actor_id ?? null],
    ),
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  for (const sql of migrations) {
    await db.exec(sql);
  }

  // Seed as the database owner, which bypasses row-level security for setup.
  await db.exec(`
    insert into auth.users (id) values
      ('${OWNER}'), ('${WRITER}'), ('${READER}'), ('${OUTSIDER}');

    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');

    -- Creating a batch adds its creator as a member (trigger), so OWNER is not listed here.
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Test batch', 'public', '${OWNER}'),
      ('${OTHER_BATCH}', 'Other batch', 'public', '${OWNER}');

    insert into public.batch_members (batch_id, user_id) values
      ('${BATCH}', '${WRITER}'), ('${BATCH}', '${READER}');

    insert into public.criteria_versions
      (id, review_name, version_number, review_topic, population, intervention,
       comparator, outcomes, design, dates, drafted_by)
    values
      ('${CRITERIA}', 'Core test review', 1, 'Topic', 'Population', 'Intervention',
       'Comparator', 'Outcomes', 'Design', 'Dates', '${OWNER}');

    insert into public.criteria_reasons (criteria_version_id, code, label) values
      ('${CRITERIA}', 'R-TOPIC-OK', 'Describes the topic.'),
      ('${CRITERIA}', 'R-TOPIC-OUT', 'Does not describe the topic.');

    insert into public.decision_events
      (id, batch_id, record_pmid, kind, outcome, reason_code, criteria_version_id, actor_id)
    values
      ('${OTHER_EVENT}', '${OTHER_BATCH}', '41435444', 'human_decision', 'include',
       'R-TOPIC-OK', '${CRITERIA}', '${OWNER}');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("append-only tables (T-2, FR-DR-04)", () => {
  it("refuses an update to a decision event, even for an owner", async () => {
    const { rows } = await insertDecision(WRITER);
    const id = rows[0].id;

    await expect(
      db.exec(`update public.decision_events set outcome = 'exclude' where id = '${id}'`),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("refuses a delete of a decision event", async () => {
    const { rows } = await insertDecision(WRITER);
    await expect(
      db.exec(`delete from public.decision_events where id = '${rows[0].id}'`),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("refuses an update or delete of an audit event", async () => {
    await db.exec(
      `insert into public.audit_events (actor_id, action, allowed)
       values ('${WRITER}', 'test', true)`,
    );
    await expect(db.exec("update public.audit_events set allowed = false")).rejects.toThrow(
      APPEND_ONLY,
    );
    await expect(db.exec("delete from public.audit_events")).rejects.toThrow(APPEND_ONLY);
  });
});

describe("row-level security (US-14, S-2)", () => {
  it("an outsider sees no batches and no decision events", async () => {
    await insertDecision(WRITER);
    const batches = await asUser(OUTSIDER, () => db.query("select id from public.batches"));
    const events = await asUser(OUTSIDER, () =>
      db.query("select id from public.decision_events"),
    );
    expect(batches.rows).toHaveLength(0);
    expect(events.rows).toHaveLength(0);
  });

  it("a read-only member can read decisions but cannot record one", async () => {
    await insertDecision(WRITER);
    const events = await asUser(READER, () =>
      db.query("select id from public.decision_events"),
    );
    expect(events.rows.length).toBeGreaterThan(0);

    await expect(insertDecision(READER)).rejects.toThrow(RLS_OR_PRIVILEGE);
  });

  it("an outsider cannot record a decision in a batch they are not in", async () => {
    await expect(insertDecision(OUTSIDER)).rejects.toThrow(RLS_OR_PRIVILEGE);
  });

  it("a reviewer can record a decision as themselves", async () => {
    const result = await insertDecision(WRITER);
    expect(result.rows[0].id).toBeTruthy();

    const actor = await asUser(WRITER, () =>
      db.query<{ actor_id: string }>(
        "select actor_id from public.decision_events where id = $1",
        [result.rows[0].id],
      ),
    );
    expect(actor.rows[0].actor_id).toBe(WRITER);
  });

  it("a reviewer cannot record a decision under someone else's name", async () => {
    await expect(insertDecision(WRITER, { actor_id: READER })).rejects.toThrow(
      RLS_OR_PRIVILEGE,
    );
  });

  it("a user sees only their own role row", async () => {
    const rows = await asUser(WRITER, () =>
      db.query<{ user_id: string }>("select user_id from public.user_roles"),
    );
    expect(rows.rows.map((r) => r.user_id)).toEqual([WRITER]);
  });
});

describe("decision rules (FR-DR-01, FR-DR-02, FR-DR-04)", () => {
  it("refuses an exclusion with no reason from the criteria list", async () => {
    await expect(
      insertDecision(WRITER, { outcome: "exclude", reason_code: null }),
    ).rejects.toThrow(/decision_reason_required/);
  });

  it("refuses a correction that does not point at the event it corrects", async () => {
    await expect(insertDecision(WRITER, { kind: "correction" })).rejects.toThrow(
      /correction_points_back/,
    );
  });

  it("accepts a correction that points at an existing event", async () => {
    const original = await insertDecision(WRITER, { outcome: "include" });
    const correction = await insertDecision(WRITER, {
      kind: "correction",
      outcome: "exclude",
      corrects_event_id: original.rows[0].id,
    });
    expect(correction.rows[0].id).toBeTruthy();
  });

  it("refuses a batch with a source label other than public or confidential", async () => {
    await expect(
      asUser(OWNER, () =>
        db.query(
          "insert into public.batches (name, source_label) values ('Bad', 'private')",
        ),
      ),
    ).rejects.toThrow(/source_label/);
  });
});

describe("schema fixes (batch creators, same-batch corrections, disagreement flags)", () => {
  it("a batch creator is made a member and can read the batch back", async () => {
    // The app supplies the id and reads the batch in a second step. Asking for the row back
    // in the same insert fails, because the creator is added as a member after the insert.
    const id = "30000000-0000-0000-0000-000000000003";
    await asUser(WRITER, () =>
      db.query(
        "insert into public.batches (id, name, source_label) values ($1, 'Mine', 'public')",
        [id],
      ),
    );

    const readBack = await asUser(WRITER, () =>
      db.query<{ id: string }>("select id from public.batches where id = $1", [id]),
    );
    expect(readBack.rows).toHaveLength(1);
  });

  it("a correction cannot point at an event in another batch", async () => {
    await expect(
      insertDecision(WRITER, { kind: "correction", corrects_event_id: OTHER_EVENT }),
    ).rejects.toThrow(/foreign key|corrects_same_batch/);
  });

  it("a disagreement flag needs no outcome or reason", async () => {
    const flag = await insertDecision(WRITER, {
      kind: "dispute_flag",
      outcome: null,
      reason_code: null,
    });
    expect(flag.rows[0].id).toBeTruthy();
  });

  it("a resolution must point at the flag it resolves", async () => {
    await expect(insertDecision(OWNER, { kind: "resolution" })).rejects.toThrow(
      /resolution_points_back/,
    );
  });

  it("an owner can resolve a flag with a reason and a link to the flag", async () => {
    const flag = await insertDecision(WRITER, {
      kind: "dispute_flag",
      outcome: null,
      reason_code: null,
    });
    const resolution = await insertDecision(OWNER, {
      kind: "resolution",
      outcome: "include",
      reason_code: "R-TOPIC-OK",
      corrects_event_id: flag.rows[0].id,
    });
    expect(resolution.rows[0].id).toBeTruthy();
  });

  it("an unknown event kind is refused", async () => {
    await expect(insertDecision(WRITER, { kind: "made_up" })).rejects.toThrow(/kind/);
  });
});

const SNAP_OK = "40000000-0000-0000-0000-000000000001";
const SNAP_OTHER = "40000000-0000-0000-0000-000000000002";
const CHECKSUM = "a".repeat(64);

type RecordFields = Partial<{
  batch_id: string;
  snapshot_id: string;
  pmid: string;
  title: string | null;
  abstract: string | null;
}>;

async function insertRecord(userId: string, overrides: RecordFields = {}) {
  const r = {
    batch_id: BATCH,
    snapshot_id: SNAP_OK,
    pmid: "41435444",
    title: "A title",
    abstract: "An abstract",
    ...overrides,
  };
  return asUser(userId, () =>
    db.query(
      `insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract)
       values ($1, $2, $3, $4, $5)`,
      [r.batch_id, r.snapshot_id, r.pmid, r.title, r.abstract],
    ),
  );
}

async function insertSnapshot(userId: string, batchId: string, id: string, checksum = CHECKSUM) {
  return asUser(userId, () =>
    db.query(
      `insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum)
       values ($1, $2, 'export.txt', 'PMID- 1', $3)`,
      [id, batchId, checksum],
    ),
  );
}

describe("source files and records (one copy per batch, append-only)", () => {
  beforeAll(async () => {
    // Seeded as the database owner, the same way as the other tables above.
    await db.exec(`
      insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by)
      values
        ('${SNAP_OK}', '${BATCH}', 'export.txt', 'PMID- 1', '${CHECKSUM}', '${WRITER}'),
        ('${SNAP_OTHER}', '${OTHER_BATCH}', 'other.txt', 'PMID- 2', '${CHECKSUM}', '${OWNER}');
    `);
  });

  it("refuses updates and deletes to a record", async () => {
    await insertRecord(WRITER, { pmid: "60000001" });
    await expect(
      db.exec("update public.records set title = 'changed' where pmid = '60000001'"),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(db.exec("delete from public.records where pmid = '60000001'")).rejects.toThrow(
      APPEND_ONLY,
    );
  });

  it("refuses updates and deletes to a source file", async () => {
    await expect(
      db.exec(`update public.source_snapshots set file_name = 'changed' where id = '${SNAP_OK}'`),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      db.exec(`delete from public.source_snapshots where id = '${SNAP_OK}'`),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("a reviewer can upload a source file and import records", async () => {
    const snapshotId = "40000000-0000-0000-0000-000000000003";
    await insertSnapshot(WRITER, BATCH, snapshotId);
    await insertRecord(WRITER, { pmid: "60000002", snapshot_id: snapshotId });

    const count = await asUser(WRITER, () =>
      db.query<{ n: number }>("select count(*)::int as n from public.records where pmid = '60000002'"),
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("a read-only member can read records but cannot import them", async () => {
    const seen = await asUser(READER, () =>
      db.query<{ n: number }>("select count(*)::int as n from public.records"),
    );
    expect(seen.rows[0].n).toBeGreaterThan(0);
    await expect(insertRecord(READER, { pmid: "60000003" })).rejects.toThrow(RLS_OR_PRIVILEGE);
  });

  it("a read-only member cannot upload a source file", async () => {
    await expect(
      insertSnapshot(READER, BATCH, "40000000-0000-0000-0000-000000000005"),
    ).rejects.toThrow(RLS_OR_PRIVILEGE);
  });

  it("an outsider sees no records or source files", async () => {
    const records = await asUser(OUTSIDER, () =>
      db.query("select id from public.records"),
    );
    const files = await asUser(OUTSIDER, () =>
      db.query("select id from public.source_snapshots"),
    );
    expect(records.rows).toHaveLength(0);
    expect(files.rows).toHaveLength(0);
  });

  it("refuses a second copy of the same PubMed ID in one batch", async () => {
    await insertRecord(WRITER, { pmid: "60000004" });
    await expect(insertRecord(WRITER, { pmid: "60000004" })).rejects.toThrow(
      /records_one_per_batch/,
    );
  });

  it("allows the same PubMed ID in a different batch", async () => {
    await insertRecord(WRITER, { pmid: "60000005" });
    await expect(
      insertRecord(OWNER, { batch_id: OTHER_BATCH, snapshot_id: SNAP_OTHER, pmid: "60000005" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a record that points at a source file in another batch", async () => {
    await expect(
      insertRecord(WRITER, { pmid: "60000006", snapshot_id: SNAP_OTHER }),
    ).rejects.toThrow(/records_snapshot_same_batch|foreign key/);
  });

  it("refuses a record with no title", async () => {
    await expect(insertRecord(WRITER, { pmid: "60000007", title: null })).rejects.toThrow(/title/);
  });

  it("refuses a PubMed ID that is not a number", async () => {
    await expect(insertRecord(WRITER, { pmid: "PMID-1" })).rejects.toThrow(/pmid/);
  });

  it("accepts a record with no abstract, so it can be flagged and screened from the title", async () => {
    await expect(
      insertRecord(WRITER, { pmid: "60000008", abstract: null }),
    ).resolves.toBeTruthy();
  });

  it("refuses a source file whose checksum is not a SHA-256 hash", async () => {
    await expect(
      insertSnapshot(WRITER, BATCH, "40000000-0000-0000-0000-000000000004", "not-a-hash"),
    ).rejects.toThrow(/checksum/);
  });
});

describe("PubMed import in one step (US-01, ADR-0010)", () => {
  const sampleRecords = (pmids: string[]) =>
    JSON.stringify(
      pmids.map((pmid) => ({
        pmid,
        doi: null,
        title: `Title ${pmid}`,
        abstract: pmid === pmids[0] ? null : `Abstract ${pmid}`,
        authors: "Writer A",
        journal: "Test Journal",
        year: 2025,
      })),
    );

  async function importBatch(userId: string, name: string, records: string, label = "public") {
    return asUser(userId, () =>
      db.query<{ id: string }>(
        `select public.import_pubmed_batch($1, $2, 'export.txt', 'PMID- 1', $3, $4::jsonb, 1, 0) as id`,
        [name, label, "b".repeat(64), records],
      ),
    );
  }

  async function batchCount(name: string) {
    const r = await db.query<{ n: number }>(
      "select count(*)::int as n from public.batches where name = $1",
      [name],
    );
    return r.rows[0].n;
  }

  it("a reviewer imports a file and gets a batch with its records and file", async () => {
    const result = await importBatch(WRITER, "Import ok", sampleRecords(["70000001", "70000002"]));
    const batchId = result.rows[0].id;

    const records = await db.query<{ n: number }>(
      "select count(*)::int as n from public.records where batch_id = $1",
      [batchId],
    );
    expect(records.rows[0].n).toBe(2);

    const file = await db.query<{ rejected_count: number; duplicate_count: number }>(
      "select rejected_count, duplicate_count from public.source_snapshots where batch_id = $1",
      [batchId],
    );
    expect(file.rows[0]).toEqual({ rejected_count: 1, duplicate_count: 0 });
  });

  it("the creator can read the new batch back", async () => {
    const result = await importBatch(WRITER, "Import readable", sampleRecords(["70000003"]));
    const readBack = await asUser(WRITER, () =>
      db.query("select id from public.batches where id = $1", [result.rows[0].id]),
    );
    expect(readBack.rows).toHaveLength(1);
  });

  it("a read-only member cannot import, and no batch is left behind", async () => {
    await expect(importBatch(READER, "Import refused", sampleRecords(["70000004"]))).rejects.toThrow(
      RLS_OR_PRIVILEGE,
    );
    expect(await batchCount("Import refused")).toBe(0);
  });

  it("refuses more than 500 records, and leaves no batch behind", async () => {
    const pmids = Array.from({ length: 501 }, (_, i) => String(71000000 + i));
    await expect(importBatch(WRITER, "Import too big", sampleRecords(pmids))).rejects.toThrow(
      /up to 500/,
    );
    expect(await batchCount("Import too big")).toBe(0);
  });

  it("refuses a file with the same PubMed ID twice, and leaves no batch behind", async () => {
    await expect(
      importBatch(WRITER, "Import duplicate", sampleRecords(["72000001", "72000001"])),
    ).rejects.toThrow(/records_one_per_batch/);
    expect(await batchCount("Import duplicate")).toBe(0);
  });

  it("refuses an unknown source label, and leaves no batch behind", async () => {
    await expect(
      importBatch(WRITER, "Import bad label", sampleRecords(["73000001"]), "private"),
    ).rejects.toThrow(/source_label/);
    expect(await batchCount("Import bad label")).toBe(0);
  });
});
