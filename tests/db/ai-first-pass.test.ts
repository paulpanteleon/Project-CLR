import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for AI first-pass proposals (US-03, FR-DR-05, FR-DR-11, FR-DR-12, T-3, ADR-0015). They run
// the real migrations against PGlite, with the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
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
const CONFIDENTIAL_BATCH = "10000000-0000-0000-0000-000000000002";
const SNAPSHOT = "40000000-0000-0000-0000-000000000001";
const CONFIDENTIAL_SNAPSHOT = "40000000-0000-0000-0000-000000000002";
const VERSION = "50000000-0000-0000-0000-00000000000a";
const OTHER_VERSION = "50000000-0000-0000-0000-00000000000b";
const PMID_1 = "70000001";
const PMID_2 = "70000002";
const PMID_UNKNOWN = "79999999";
const CHECKSUM = "a".repeat(64);
const ROUTE = "amazon-bedrock/us-east-1";
const MODEL = "anthropic/claude-haiku-5.5";
const PROMPT = "first-pass-v1";

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

type ProposalArgs = {
  batch?: string;
  pmid?: string;
  model?: string;
  status?: string;
  outcome?: string | null;
  reason?: string | null;
  rationale?: string | null;
  route?: string;
  zdr?: boolean;
};

function store(userId: string, args: ProposalArgs = {}) {
  const status = args.status ?? "proposed";
  const proposed = status === "proposed";
  return asUser(userId, () =>
    db.query<{ r: string }>(
      "select public.store_ai_proposal($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) as r",
      [
        args.batch ?? BATCH,
        args.pmid ?? PMID_1,
        args.model ?? MODEL,
        PROMPT,
        JSON.stringify({ temperature: 0, max_tokens: 400 }),
        '{"outcome":"include"}',
        status,
        args.outcome !== undefined ? args.outcome : proposed ? "include" : null,
        args.reason !== undefined ? args.reason : proposed ? "R-TOPIC-OK" : null,
        args.rationale !== undefined ? args.rationale : proposed ? "Matches the topic." : null,
        "Amazon Bedrock",
        args.route ?? ROUTE,
        args.zdr ?? true,
        "global",
        "gen-test-1",
      ],
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
    insert into auth.users (id) values ('${OWNER}'), ('${WRITER}'), ('${READER}'), ('${OUTSIDER}');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Public batch', 'public', '${OWNER}'),
      ('${CONFIDENTIAL_BATCH}', 'Confidential batch', 'confidential', '${OWNER}');
    insert into public.batch_members (batch_id, user_id) values
      ('${BATCH}', '${WRITER}'), ('${BATCH}', '${READER}'), ('${CONFIDENTIAL_BATCH}', '${WRITER}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by) values
      ('${SNAPSHOT}', '${BATCH}', 'export.txt', 'PMID- 70000001', '${CHECKSUM}', '${OWNER}'),
      ('${CONFIDENTIAL_SNAPSHOT}', '${CONFIDENTIAL_BATCH}', 'export.txt', 'PMID- 70000001', '${CHECKSUM}', '${OWNER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract) values
      ('${BATCH}', '${SNAPSHOT}', '${PMID_1}', 'First record', 'An abstract.'),
      ('${BATCH}', '${SNAPSHOT}', '${PMID_2}', 'Second record', 'Another abstract.'),
      ('${CONFIDENTIAL_BATCH}', '${CONFIDENTIAL_SNAPSHOT}', '${PMID_1}', 'Confidential record', 'Private.');
  `);

  // Criteria: an approved version for the public batch, and a second version with its own reason.
  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'First review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION]));
  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Other review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [OTHER_VERSION, JSON.stringify([{ code: "R-OTHER", label: "Only in the other review." }])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [OTHER_VERSION]));
  await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [BATCH, VERSION]));
});

afterAll(async () => {
  await db?.close();
});

describe("store_ai_proposal", () => {
  it("stores a proposal with its reproducibility set, for a reviewer", async () => {
    const result = await store(WRITER);
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{
      criteria_version_id: string;
      route_tag: string;
      zdr_enforced: boolean;
      status: string;
      outcome: string;
      generation_id: string;
      actor_id: string;
    }>(
      `select criteria_version_id, route_tag, zdr_enforced, status, outcome, generation_id, actor_id
       from public.ai_proposals where batch_id = $1 and record_pmid = $2`,
      [BATCH, PMID_1],
    );
    expect(rows).toEqual([
      {
        criteria_version_id: VERSION,
        route_tag: ROUTE,
        zdr_enforced: true,
        status: "proposed",
        outcome: "include",
        generation_id: "gen-test-1",
        actor_id: WRITER,
      },
    ]);
  });

  it("stores a reply that could not be read, with its raw text and no outcome", async () => {
    const result = await store(WRITER, { pmid: PMID_2, status: "invalid", model: "anthropic/claude-sonnet-5.5" });
    expect(result.rows[0].r).toBe("ok");

    const { rows } = await db.query<{ status: string; outcome: string | null; raw_output: string }>(
      "select status, outcome, raw_output from public.ai_proposals where batch_id = $1 and record_pmid = $2 and model_id = $3",
      [BATCH, PMID_2, "anthropic/claude-sonnet-5.5"],
    );
    expect(rows).toEqual([{ status: "invalid", outcome: null, raw_output: '{"outcome":"include"}' }]);
  });

  it("refuses a second proposal for the same record, model and prompt version", async () => {
    const result = await store(WRITER);
    expect(result.rows[0].r).toBe("duplicate");
  });

  it("refuses a read-only member, and audits it", async () => {
    const result = await store(READER, { pmid: PMID_2, model: "anthropic/claude-sonnet-5.5" });
    expect(result.rows[0].r).toBe("denied");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'ai.store_proposal'",
      [READER],
    );
    expect(audit.rows).toEqual([{ allowed: false }]);
  });

  it("refuses someone who is not a member of the batch", async () => {
    const result = await store(OUTSIDER, { pmid: PMID_2, model: "anthropic/claude-sonnet-5.5" });
    expect(result.rows[0].r).toBe("denied");
  });

  it("refuses a confidential batch, whatever the route", async () => {
    const result = await store(WRITER, { batch: CONFIDENTIAL_BATCH });
    expect(result.rows[0].r).toBe("confidential_not_allowed");
  });

  it("refuses a record that is not in the batch", async () => {
    const result = await store(WRITER, { pmid: PMID_UNKNOWN });
    expect(result.rows[0].r).toBe("not_in_batch");
  });

  it("refuses any route other than the pinned one, even when written directly", async () => {
    await expect(store(WRITER, { route: "google-vertex/us", model: "anthropic/claude-sonnet-5.5" })).rejects.toThrow(
      /route_tag/,
    );
  });

  it("refuses a proposal that did not use zero retention", async () => {
    await expect(store(WRITER, { zdr: false, model: "anthropic/claude-sonnet-5.5" })).rejects.toThrow(/zdr_enforced/);
  });

  it("refuses a reason that is not in the batch's criteria version", async () => {
    await expect(
      store(WRITER, { reason: "R-OTHER", model: "anthropic/claude-sonnet-5.5" }),
    ).rejects.toThrow(/ai_proposals_reason_from_version/);
  });

  it("refuses a proposed row with no rationale", async () => {
    await expect(store(WRITER, { rationale: null, model: "anthropic/claude-sonnet-5.5" })).rejects.toThrow(
      /ai_proposals_proposed_complete/,
    );
  });

  it("refuses an invalid row that carries an outcome", async () => {
    await expect(
      store(WRITER, { status: "invalid", outcome: "include", reason: null, rationale: null, model: "x/y" }),
    ).rejects.toThrow(/ai_proposals_invalid_has_no_outcome/);
  });
});

describe("ai_proposals access and history", () => {
  it("lets members read the proposals, and keeps them from outsiders", async () => {
    const reader = await asUser(READER, () =>
      db.query("select id from public.ai_proposals where batch_id = $1", [BATCH]),
    );
    expect(reader.rows.length).toBeGreaterThan(0);

    const outsider = await asUser(OUTSIDER, () =>
      db.query("select id from public.ai_proposals where batch_id = $1", [BATCH]),
    );
    expect(outsider.rows).toEqual([]);
  });

  it("refuses a direct insert by a signed-in user", async () => {
    await expect(
      asUser(WRITER, () =>
        db.query(
          `insert into public.ai_proposals
             (batch_id, record_pmid, criteria_version_id, prompt_version, model_id, settings, raw_output, status,
              outcome, reason_code, rationale, upstream_provider, route_tag, zdr_enforced, generation_id)
           values ($1, $2, $3, $4, 'x/y', '{}', 'raw', 'invalid', null, null, null, 'Amazon Bedrock', $5, true, 'g')`,
          [BATCH, PMID_1, VERSION, PROMPT, ROUTE],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps proposals append-only", async () => {
    await expect(db.query("update public.ai_proposals set outcome = 'exclude'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.ai_proposals")).rejects.toThrow(/append-only/);
  });
});
