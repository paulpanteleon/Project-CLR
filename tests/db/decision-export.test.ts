import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for batch_decision_export (ADR-0017). They run the real migrations against PGlite, with
// the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer, created the batch
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only, member
const OUTSIDER = "00000000-0000-0000-0000-00000000000d"; // medical writer, reviewer, not a member
const BATCH = "10000000-0000-0000-0000-000000000001";
const SNAPSHOT = "40000000-0000-0000-0000-000000000001";
const VERSION = "50000000-0000-0000-0000-00000000000a";
const PMID_1 = "70000001";
const PMID_2 = "70000002";
const PMID_3 = "70000003";

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

type Row = {
  pmid: string;
  title: string;
  outcome: string | null;
  reason_code: string | null;
  reason_label: string | null;
  supporting_text: string | null;
  decided_by: string | null;
  corrections: number;
  criteria_version: string | null;
};

function exportAs(userId: string) {
  return asUser(userId, () =>
    db.query<Row>(
      `select pmid, title, outcome, reason_code, reason_label, supporting_text, decided_by, corrections, criteria_version
       from public.batch_decision_export($1)`,
      [BATCH],
    ),
  );
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
    insert into public.batches (id, name, source_label, created_by) values ('${BATCH}', 'Export batch', 'public', '${WRITER}');
    insert into public.batch_members (batch_id, user_id) values ('${BATCH}', '${READER}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by)
      values ('${SNAPSHOT}', '${BATCH}', 'export.txt', 'PMID- 70000001', '${"a".repeat(64)}', '${WRITER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract) values
      ('${BATCH}', '${SNAPSHOT}', '${PMID_1}', 'First record', 'An abstract.'),
      ('${BATCH}', '${SNAPSHOT}', '${PMID_2}', 'Second record', 'Another abstract.'),
      ('${BATCH}', '${SNAPSHOT}', '${PMID_3}', 'Third record', null);
  `);

  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Export review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION]));
  await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [BATCH, VERSION]));

  // Record 1: included, then corrected to excluded. Record 2: included. Record 3: no decision.
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'Looks on topic.')", [BATCH, PMID_1]),
  );
  const { rows } = await db.query<{ id: string }>(
    "select id from public.decision_events where batch_id = $1 and record_pmid = $2",
    [BATCH, PMID_1],
  );
  await asUser(WRITER, () =>
    db.query("select public.correct_screening_decision($1, 'exclude', 'R-TOPIC-OUT', 'Off topic on a second read.')", [
      rows[0].id,
    ]),
  );
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'Matches.')", [BATCH, PMID_2]),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("batch_decision_export", () => {
  it("gives a read-only member one row per record, in PMID order", async () => {
    const { rows } = await exportAs(READER);
    expect(rows.map((row) => row.pmid)).toEqual([PMID_1, PMID_2, PMID_3]);
  });

  it("shows the latest outcome after a correction, with its reason, text, reviewer and correction count", async () => {
    const { rows } = await exportAs(READER);
    expect(rows[0]).toEqual({
      pmid: PMID_1,
      title: "First record",
      outcome: "exclude",
      reason_code: "R-TOPIC-OUT",
      reason_label: "Does not describe the topic.",
      supporting_text: "Off topic on a second read.",
      decided_by: "writer@example.com",
      corrections: 1,
      criteria_version: "Export review, version 1",
    });
  });

  it("includes a record without a decision, with empty decision fields", async () => {
    const { rows } = await exportAs(READER);
    expect(rows[2]).toMatchObject({ pmid: PMID_3, outcome: null, decided_by: null, criteria_version: null, corrections: 0 });
  });

  it("records each export in the audit history", async () => {
    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'batch.export_decisions'",
      [READER],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    expect(audit.rows.every((row) => row.allowed)).toBe(true);
  });

  it("returns nothing to someone who is not a member, and audits the refusal", async () => {
    const { rows } = await exportAs(OUTSIDER);
    expect(rows).toEqual([]);

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'batch.export_decisions'",
      [OUTSIDER],
    );
    expect(audit.rows).toEqual([{ allowed: false }]);
  });
});
