import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// These tests run the real migration against PGlite (PostgreSQL in Node), with a
// stand-in for Supabase's auth schema (see supabase-shim.sql). Each test signs in
// as a user by setting the same claim Supabase sets, then switches to the
// "authenticated" role, so row-level security applies exactly as it would in production.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/20261104000000_core_schema.sql"),
  "utf8",
);

const OWNER = "00000000-0000-0000-0000-00000000000a";
const WRITER = "00000000-0000-0000-0000-00000000000b";
const READER = "00000000-0000-0000-0000-00000000000c";
const OUTSIDER = "00000000-0000-0000-0000-00000000000d";
const BATCH = "10000000-0000-0000-0000-000000000001";

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
         (batch_id, record_pmid, kind, outcome, reason_code, criteria_version,
          corrects_event_id, actor_id)
       values ($1, '41435444', $2, $3, $4, 'v1', $5, coalesce($6, auth.uid()))
       returning id`,
      [BATCH, row.kind, row.outcome, row.reason_code, row.corrects_event_id, row.actor_id ?? null],
    ),
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  await db.exec(migration);

  // Seed as the database owner, which bypasses row-level security for setup.
  await db.exec(`
    insert into auth.users (id) values
      ('${OWNER}'), ('${WRITER}'), ('${READER}'), ('${OUTSIDER}');

    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');

    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Test batch', 'public', '${OWNER}');

    insert into public.batch_members (batch_id, user_id) values
      ('${BATCH}', '${OWNER}'), ('${BATCH}', '${WRITER}'), ('${BATCH}', '${READER}');
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
