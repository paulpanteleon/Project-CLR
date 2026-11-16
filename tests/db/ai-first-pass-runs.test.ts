import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for background AI first-pass runs and their per-run keys (US-03, ADR-0018). They run the
// real migrations against PGlite, with the Supabase stand-in from supabase-shim.sql. The key
// functions are called as the anon role, as the background steps call them.

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
const SECOND = "00000000-0000-0000-0000-00000000000d"; // medical writer, reviewer, member
const BATCH = "10000000-0000-0000-0000-000000000001";
const CONFIDENTIAL = "10000000-0000-0000-0000-000000000002";
const NO_CRITERIA = "10000000-0000-0000-0000-000000000003";
const SNAPSHOT = "40000000-0000-0000-0000-000000000001";
const VERSION = "50000000-0000-0000-0000-00000000000a";
const PMID_1 = "70000001";
const PMID_2 = "70000002";
const HAIKU = "anthropic/claude-haiku-5.5";
const SONNET = "anthropic/claude-sonnet-5.5";
const PROMPT = "first-pass-v1";
const ROUTE = "amazon-bedrock/us-east-1";

let db: PGlite;

const hash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

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

// No sign-in, as in a background step.
async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function startRun(userId: string, batchId: string, model: string, key: string) {
  const { rows } = await asUser(userId, () =>
    db.query<{ result: string; run_id: string | null }>("select * from public.start_ai_run($1, $2, $3, $4)", [
      batchId,
      model,
      PROMPT,
      hash(key),
    ]),
  );
  return rows[0];
}

async function storeProposal(runId: string, key: string, pmid: string, status = "proposed") {
  const proposed = status === "proposed";
  const { rows } = await asAnon(() =>
    db.query<{ r: string }>(
      "select public.store_ai_run_proposal($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) as r",
      [
        runId,
        key,
        pmid,
        JSON.stringify({ max_tokens: 400 }),
        '{"outcome":"exclude"}',
        status,
        proposed ? "exclude" : null,
        proposed ? "R-TOPIC-OUT" : null,
        proposed ? "Off topic." : null,
        "Amazon Bedrock",
        ROUTE,
        true,
        "global",
        `gen-${pmid}`,
      ],
    ),
  );
  return rows[0].r;
}

async function pending(runId: string, key: string) {
  const { rows } = await asAnon(() =>
    db.query<{ pmid: string }>("select public.ai_run_pending_records($1, $2) as pmid", [runId, key]),
  );
  return rows.map((row) => row.pmid);
}

async function run(runId: string) {
  const { rows } = await db.query<{
    status: string;
    total: number;
    proposed: number;
    unreadable: number;
    failed: number;
    key_hash: string | null;
    last_error: string | null;
  }>("select status, total, proposed, unreadable, failed, key_hash, last_error from public.ai_runs where id = $1", [runId]);
  return rows[0];
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
      ('${READER}', 'reader@example.com'), ('${SECOND}', 'second@example.com');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${SECOND}', 'medical_writer', 'reviewer');
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Public batch', 'public', '${WRITER}'),
      ('${CONFIDENTIAL}', 'Confidential batch', 'confidential', '${WRITER}'),
      ('${NO_CRITERIA}', 'No criteria batch', 'public', '${WRITER}');
    insert into public.batch_members (batch_id, user_id) values
      ('${BATCH}', '${READER}'), ('${BATCH}', '${SECOND}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by)
      values ('${SNAPSHOT}', '${BATCH}', 'export.txt', 'PMID- 70000001', '${"a".repeat(64)}', '${WRITER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract) values
      ('${BATCH}', '${SNAPSHOT}', '${PMID_1}', 'First record', 'An abstract.'),
      ('${BATCH}', '${SNAPSHOT}', '${PMID_2}', 'Second record', null);
  `);

  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Run review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION]));
  await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [BATCH, VERSION]));
  await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [CONFIDENTIAL, VERSION]));
});

afterAll(async () => {
  await db?.close();
});

describe("start_ai_run", () => {
  it("refuses a read-only member, a confidential batch and a batch with no criteria, and audits them", async () => {
    expect((await startRun(READER, BATCH, HAIKU, "k")).result).toBe("denied");
    expect((await startRun(WRITER, CONFIDENTIAL, HAIKU, "k")).result).toBe("confidential_not_allowed");
    expect((await startRun(WRITER, NO_CRITERIA, HAIKU, "k")).result).toBe("no_criteria");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where action = 'ai.start_run'",
    );
    expect(audit.rows.every((row) => row.allowed === false)).toBe(true);
  });

  it("is not available without a sign-in", async () => {
    await expect(
      asAnon(() => db.query("select * from public.start_ai_run($1, $2, $3, $4)", [BATCH, HAIKU, PROMPT, hash("k")])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a run and its key", () => {
  const key = "haiku-run-key";
  let runId: string;

  beforeAll(async () => {
    const started = await startRun(WRITER, BATCH, HAIKU, key);
    expect(started.result).toBe("ok");
    runId = started.run_id!;
  });

  it("counts the records that need a proposal", async () => {
    expect((await run(runId)).total).toBe(2);
  });

  it("allows only one running run per batch, model and prompt version", async () => {
    expect((await startRun(SECOND, BATCH, HAIKU, "other")).result).toBe("already_running");
  });

  it("lists the pending records with the right key, and nothing with a wrong one", async () => {
    expect(await pending(runId, key)).toEqual([PMID_1, PMID_2]);
    expect(await pending(runId, "wrong")).toEqual([]);
  });

  it("gives a step the criteria and the record, but only with the right key", async () => {
    const { rows } = await asAnon(() =>
      db.query<{ item: { criteria: { reviewTopic: string; reasons: unknown[] }; record: { title: string } } | null }>(
        "select public.ai_run_work_item($1, $2, $3) as item",
        [runId, key, PMID_1],
      ),
    );
    expect(rows[0].item?.criteria.reviewTopic).toBe("Topic");
    expect(rows[0].item?.criteria.reasons).toHaveLength(2);
    expect(rows[0].item?.record.title).toBe("First record");

    const wrong = await asAnon(() =>
      db.query<{ item: unknown }>("select public.ai_run_work_item($1, $2, $3) as item", [runId, "wrong", PMID_1]),
    );
    expect(wrong.rows[0].item).toBeNull();
  });

  it("stores a proposal as the person who started the run, and counts it", async () => {
    expect(await storeProposal(runId, key, PMID_1)).toBe("ok");

    const { rows } = await db.query<{ actor_id: string; model_id: string }>(
      "select actor_id, model_id from public.ai_proposals where batch_id = $1 and record_pmid = $2",
      [BATCH, PMID_1],
    );
    expect(rows).toEqual([{ actor_id: WRITER, model_id: HAIKU }]);
    expect((await run(runId)).proposed).toBe(1);
    expect(await pending(runId, key)).toEqual([PMID_2]);
  });

  it("refuses a second proposal for the same record, and a wrong key", async () => {
    expect(await storeProposal(runId, key, PMID_1)).toBe("duplicate");
    expect(await storeProposal(runId, "wrong", PMID_2)).toBe("invalid_key");
  });

  it("counts an unreadable reply and a failure separately", async () => {
    expect(await storeProposal(runId, key, PMID_2, "invalid")).toBe("ok");
    const { rows } = await asAnon(() =>
      db.query<{ r: string }>("select public.record_ai_run_failure($1, $2, $3) as r", [runId, key, "PMID 0: timeout"]),
    );
    expect(rows[0].r).toBe("ok");
    expect(await run(runId)).toMatchObject({ proposed: 1, unreadable: 1, failed: 1, last_error: "PMID 0: timeout" });
  });

  it("ends the run and clears the key, so the key stops working", async () => {
    const { rows } = await asAnon(() =>
      db.query<{ r: string }>("select public.finish_ai_run($1, $2, false, null) as r", [runId, key]),
    );
    expect(rows[0].r).toBe("ok");
    expect(await run(runId)).toMatchObject({ status: "finished", key_hash: null });
    expect(await pending(runId, key)).toEqual([]);
    expect(await storeProposal(runId, key, PMID_2)).toBe("invalid_key");
  });

  it("says there is nothing to do when every record has a proposal", async () => {
    expect((await startRun(WRITER, BATCH, HAIKU, "again")).result).toBe("nothing_to_do");
  });
});

describe("a run whose starter loses access, or that expires", () => {
  it("stops storing when the starter is removed from the batch", async () => {
    const key = "second-run-key";
    const started = await startRun(SECOND, BATCH, SONNET, key);
    expect(started.result).toBe("ok");

    await asUser(WRITER, () => db.query("select public.remove_batch_member($1, $2)", [BATCH, SECOND]));
    expect(await storeProposal(started.run_id!, key, PMID_1)).toBe("denied");

    await db.exec(`update public.ai_runs set expires_at = now() - interval '1 minute' where id = '${started.run_id}'`);
  });

  it("refuses an expired key, and closes the expired run when a new one starts", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.ai_runs where model_id = $1 and status = 'running'",
      [SONNET],
    );
    const expired = rows[0].id;
    expect(await storeProposal(expired, "second-run-key", PMID_1)).toBe("invalid_key");

    expect((await startRun(WRITER, BATCH, SONNET, "fresh")).result).toBe("ok");
    expect(await run(expired)).toMatchObject({ status: "failed", key_hash: null, last_error: "Expired before it finished." });
  });
});

describe("ai_runs access", () => {
  it("lets members read run progress, but never the key hash", async () => {
    const progress = await asUser(READER, () =>
      db.query("select status, total, proposed from public.ai_runs where batch_id = $1", [BATCH]),
    );
    expect(progress.rows.length).toBeGreaterThan(0);

    await expect(
      asUser(READER, () => db.query("select key_hash from public.ai_runs where batch_id = $1", [BATCH])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses direct changes to a run, and any read without a sign-in", async () => {
    await expect(
      asUser(WRITER, () => db.query("update public.ai_runs set status = 'finished' where batch_id = $1", [BATCH])),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select id from public.ai_runs"))).rejects.toThrow(/permission denied/);
  });
});
