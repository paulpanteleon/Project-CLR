import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for the review log and its share links (ADR-0020). They run the real migrations against
// PGlite, with the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner, not a member
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer, created the batch
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only, member
const OUTSIDER = "00000000-0000-0000-0000-00000000000d"; // clinician reviewer, read-only, not a member
const NO_ROLE = "00000000-0000-0000-0000-00000000000e"; // signed in, no role
const BATCH = "10000000-0000-0000-0000-000000000001";
const OTHER_BATCH = "10000000-0000-0000-0000-000000000002";
const VERSION = "50000000-0000-0000-0000-00000000000a";
const PMID_1 = "70000001";
const PMID_2 = "70000002";

let db: PGlite;

function hash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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

type Log = {
  result: string;
  share?: { named: boolean } | null;
  batch?: { name: string };
  criteria_version?: { review_name: string; reasons: { code: string }[] };
  records?: { pmid: string; outcome: string | null; decided_by: string | null; corrections: number; proposals: unknown[] }[];
};

async function log(userId: string, batchId: string | null, token: string | null) {
  const { rows } = await asUser(userId, () =>
    db.query<{ log: Log }>("select public.review_log($1, $2) as log", [batchId, token ? hash(token) : null]),
  );
  return rows[0].log;
}

type Detail = {
  result: string;
  record?: { pmid: string; title: string };
  events?: { kind: string; actor_email: string }[];
  proposals?: { model_id: string; actor_email: string; raw_output: string }[];
  criteria_version?: { review_name: string };
};

async function detail(userId: string, batchId: string | null, pmid: string, token: string | null) {
  const { rows } = await asUser(userId, () =>
    db.query<{ detail: Detail }>("select public.record_decision_detail($1, $2, $3) as detail", [
      batchId,
      pmid,
      token ? hash(token) : null,
    ]),
  );
  return rows[0].detail;
}

async function share(userId: string, token: string, email: string | null, days: number, batchId = BATCH) {
  const { rows } = await asUser(userId, () =>
    db.query<{ result: string; share_id: string | null }>(
      "select * from public.create_review_log_share($1, $2, $3, $4)",
      [batchId, hash(token), email, days],
    ),
  );
  return rows[0];
}

async function audit(action: string, actor: string) {
  const { rows } = await db.query<{ target: string; allowed: boolean }>(
    "select target, allowed from public.audit_events where action = $1 and actor_id = $2 order by occurred_at, id",
    [action, actor],
  );
  return rows;
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
      ('${READER}', 'reader@example.com'), ('${OUTSIDER}', 'Outsider@Example.com'),
      ('${NO_ROLE}', 'norole@example.com');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${OUTSIDER}', 'clinician_reviewer', 'read_only');
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Shared batch', 'public', '${WRITER}'),
      ('${OTHER_BATCH}', 'Other batch', 'public', '${WRITER}');
    insert into public.batch_members (batch_id, user_id) values ('${BATCH}', '${READER}');
    insert into public.source_snapshots (id, batch_id, file_name, file_text, checksum, uploaded_by) values
      ('40000000-0000-0000-0000-000000000001', '${BATCH}', 'shared.txt', 'PMID- 1', '${"a".repeat(64)}', '${WRITER}'),
      ('40000000-0000-0000-0000-000000000002', '${OTHER_BATCH}', 'other.txt', 'PMID- 2', '${"b".repeat(64)}', '${WRITER}');
    insert into public.records (batch_id, source_snapshot_id, pmid, title, abstract) values
      ('${BATCH}', '40000000-0000-0000-0000-000000000001', '${PMID_1}', 'First record', 'An abstract.'),
      ('${BATCH}', '40000000-0000-0000-0000-000000000001', '${PMID_2}', 'Second record', null),
      ('${OTHER_BATCH}', '40000000-0000-0000-0000-000000000002', '${PMID_1}', 'Other first record', 'Other.');
  `);

  await asUser(WRITER, () =>
    db.query(
      "select public.create_criteria_version($1, 'Shared review', 'Topic', 'Pop', 'Int', 'Comp', 'Out', 'Design', 'Dates', $2::jsonb)",
      [VERSION, JSON.stringify([
        { code: "R-TOPIC-OK", label: "Describes the topic." },
        { code: "R-TOPIC-OUT", label: "Does not describe the topic." },
      ])],
    ),
  );
  await asUser(OWNER, () => db.query("select public.approve_criteria_version($1)", [VERSION]));
  await asUser(WRITER, () => db.query("select public.set_batch_criteria($1, $2)", [BATCH, VERSION]));

  // An AI proposal (inserted directly; its own rules are tested elsewhere), then a decision and a
  // correction on record 1. Record 2 stays undecided.
  await db.query(
    `insert into public.ai_proposals (batch_id, record_pmid, criteria_version_id, prompt_version, model_id, settings,
       raw_output, status, outcome, reason_code, rationale, upstream_provider, route_tag, zdr_enforced, generation_id, actor_id)
     values ($1, $2, $3, 'first-pass-v1', 'anthropic/claude-haiku-5.5', '{}', '{"outcome":"exclude"}', 'proposed',
       'exclude', 'R-TOPIC-OUT', 'Off topic.', 'Amazon Bedrock', 'amazon-bedrock/us-east-1', true, 'gen-1', $4)`,
    [BATCH, PMID_1, VERSION, WRITER],
  );
  await asUser(WRITER, () =>
    db.query("select public.record_screening_decision($1, $2, 'include', 'R-TOPIC-OK', 'On topic.')", [BATCH, PMID_1]),
  );
  const { rows } = await db.query<{ id: string }>(
    "select id from public.decision_events where batch_id = $1 and record_pmid = $2",
    [BATCH, PMID_1],
  );
  await asUser(WRITER, () =>
    db.query("select public.correct_screening_decision($1, 'exclude', 'R-TOPIC-OUT', 'Off topic after all.')", [
      rows[0].id,
    ]),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("creating share links", () => {
  it("lets the batch's creator make an open link and a named link", async () => {
    expect(await share(WRITER, "open-token", null, 7)).toMatchObject({ result: "ok" });
    expect(await share(WRITER, "named-token", "  OUTSIDER@example.COM ", 1)).toMatchObject({ result: "ok" });
  });

  it("refuses a member who cannot manage the batch, and a non-member", async () => {
    expect(await share(READER, "reader-token", null, 7)).toEqual({ result: "denied", share_id: null });
    expect(await share(OUTSIDER, "outsider-token", null, 7)).toEqual({ result: "denied", share_id: null });
  });

  it("refuses an expiry other than 1, 7 or 30 days", async () => {
    expect((await share(WRITER, "bad-expiry", null, 365)).result).toBe("invalid_expiry");
  });

  it("refuses a named link for someone with no account or no role", async () => {
    expect((await share(WRITER, "nobody", "nobody@example.com", 7)).result).toBe("unknown_recipient");
    expect((await share(WRITER, "no-role", "norole@example.com", 7)).result).toBe("unknown_recipient");
  });

  it("audits every attempt", async () => {
    const attempts = await audit("review_log.share", WRITER);
    expect(attempts.map((row) => row.allowed)).toEqual([true, true, false, false, false]);
    expect((await audit("review_log.share", READER))[0]).toMatchObject({ allowed: false });
  });
});

describe("review_log", () => {
  it("gives a member the log without a link, with outcomes, reviewers and AI proposals", async () => {
    const result = await log(READER, BATCH, null);
    expect(result).toMatchObject({ result: "ok", share: null, batch: { name: "Shared batch" } });
    expect(result.criteria_version?.reasons.map((reason) => reason.code)).toEqual(["R-TOPIC-OK", "R-TOPIC-OUT"]);
    expect(result.records).toEqual([
      expect.objectContaining({
        pmid: PMID_1,
        outcome: "exclude",
        decided_by: "writer@example.com",
        corrections: 1,
        proposals: [expect.objectContaining({ model_id: "anthropic/claude-haiku-5.5", outcome: "exclude" })],
      }),
      expect.objectContaining({ pmid: PMID_2, outcome: null, decided_by: null, corrections: 0, proposals: [] }),
    ]);
  });

  it("refuses a non-member without a link", async () => {
    expect(await log(OUTSIDER, BATCH, null)).toEqual({ result: "denied", expires_at: null });
  });

  it("opens through an open link for anyone signed in with a role", async () => {
    const result = await log(OWNER, null, "open-token");
    expect(result).toMatchObject({ result: "ok", share: { named: false }, batch: { name: "Shared batch" } });
    expect(result.records).toHaveLength(2);
  });

  it("refuses someone with no role, even with an open link", async () => {
    expect((await log(NO_ROLE, null, "open-token")).result).toBe("no_role");
  });

  it("opens a named link only for the person it names, in any letter case", async () => {
    expect((await log(OUTSIDER, null, "named-token")).result).toBe("ok");
    expect((await log(OWNER, null, "named-token")).result).toBe("wrong_person");
  });

  it("refuses an unknown link, or a link used for a different batch", async () => {
    expect((await log(OUTSIDER, null, "made-up-token")).result).toBe("not_found");
    expect((await log(OUTSIDER, OTHER_BATCH, "named-token")).result).toBe("not_found");
  });

  it("refuses an expired link", async () => {
    await db.query(
      `insert into public.review_log_shares (batch_id, token_hash, expires_at, created_by, created_at)
       values ($1, $2, now() - interval '1 day', $3, now() - interval '8 days')`,
      [BATCH, hash("expired-token"), WRITER],
    );
    expect((await log(OUTSIDER, null, "expired-token")).result).toBe("expired");
  });

  it("does not make the viewer a member: direct reads of the batch still return nothing", async () => {
    const { rows } = await asUser(OUTSIDER, () => db.query("select pmid from public.records where batch_id = $1", [BATCH]));
    expect(rows).toEqual([]);
  });

  it("audits every view, allowed or not, and names the share used", async () => {
    const views = await audit("review_log.view", OUTSIDER);
    expect(views.map((row) => row.allowed)).toEqual([false, true, false, false, false]);
    expect(views[1].target).toMatch(new RegExp(`^${BATCH}/share/[0-9a-f-]{36}$`));
    expect((await audit("review_log.view", READER))[0]).toEqual({ target: BATCH, allowed: true });
  });

  it("is not available to the anon role", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select public.review_log(null, $1)", [hash("open-token")])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("record_decision_detail", () => {
  it("gives a member the record, its events and proposals with emails, and the criteria applied", async () => {
    const result = await detail(READER, BATCH, PMID_1, null);
    expect(result).toMatchObject({ result: "ok", record: { pmid: PMID_1, title: "First record" } });
    expect(result.events?.map((event) => [event.kind, event.actor_email])).toEqual([
      ["human_decision", "writer@example.com"],
      ["correction", "writer@example.com"],
    ]);
    expect(result.proposals?.[0]).toMatchObject({ actor_email: "writer@example.com", raw_output: '{"outcome":"exclude"}' });
    expect(result.criteria_version?.review_name).toBe("Shared review");
  });

  it("opens through a share link, and refuses a record outside the shared batch", async () => {
    expect((await detail(OWNER, null, PMID_2, "open-token")).result).toBe("ok");
    expect((await detail(OWNER, null, "79999999", "open-token")).result).toBe("not_found");
    expect((await detail(OWNER, OTHER_BATCH, PMID_1, "open-token")).result).toBe("not_found");
  });

  it("refuses a non-member without a link, and audits the view either way", async () => {
    expect((await detail(OUTSIDER, BATCH, PMID_1, null)).result).toBe("denied");
    const views = await audit("decision.view", OUTSIDER);
    expect(views).toEqual([{ target: `${BATCH}/record/${PMID_1}`, allowed: false }]);
  });
});

describe("revoking and listing links", () => {
  async function shareId(token: string) {
    const { rows } = await db.query<{ id: string }>("select id from public.review_log_shares where token_hash = $1", [
      hash(token),
    ]);
    return rows[0].id;
  }

  async function revoke(userId: string, id: string) {
    const { rows } = await asUser(userId, () =>
      db.query<{ result: string }>("select public.revoke_review_log_share($1) as result", [id]),
    );
    return rows[0].result;
  }

  it("lists a batch's links for its managers, with status and views, and never the hash", async () => {
    const { rows, fields } = await asUser(WRITER, () =>
      db.query<{ recipient_email: string | null; status: string; views: number }>(
        "select * from public.review_log_shares_for_batch($1)",
        [BATCH],
      ),
    );
    expect(fields.map((field) => field.name)).not.toContain("token_hash");
    expect(rows.map((row) => [row.recipient_email, row.status])).toEqual(
      expect.arrayContaining([
        [null, "active"],
        ["outsider@example.com", "active"],
        [null, "expired"],
      ]),
    );
    const open = rows.find((row) => row.recipient_email === null && row.status === "active");
    expect(open?.views).toBeGreaterThanOrEqual(2);
  });

  it("lists nothing for someone who cannot manage the batch", async () => {
    const { rows } = await asUser(READER, () => db.query("select * from public.review_log_shares_for_batch($1)", [BATCH]));
    expect(rows).toEqual([]);
  });

  it("revokes a link only for a manager, once, and the link stops working", async () => {
    const id = await shareId("open-token");
    expect(await revoke(READER, id)).toBe("denied");
    expect(await revoke(WRITER, id)).toBe("ok");
    expect(await revoke(WRITER, id)).toBe("already_ended");
    expect((await log(OWNER, null, "open-token")).result).toBe("revoked");
    expect(await revoke(WRITER, await shareId("expired-token"))).toBe("already_ended");
  });

  it("keeps the table out of direct reach, and refuses any change but one revocation", async () => {
    await asUser(WRITER, async () => {
      await expect(db.query("select * from public.review_log_shares")).rejects.toThrow(/permission denied/);
    });
    const id = await shareId("named-token");
    await expect(
      db.query("update public.review_log_shares set expires_at = expires_at + interval '1 day' where id = $1", [id]),
    ).rejects.toThrow(/can only be revoked/);
    await expect(db.query("delete from public.review_log_shares where id = $1", [id])).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});

describe("find_decisions", () => {
  it("records each search in the audit history", async () => {
    await asUser(READER, () => db.query("select * from public.find_decisions('first')"));
    expect(await audit("decision.search", READER)).toEqual([{ target: "all batches", allowed: true }]);
  });
});
