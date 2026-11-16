import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for adding and removing people on a batch (US-14, ADR-0016). They run the real migrations
// against PGlite, with the Supabase stand-in from supabase-shim.sql.

const ROOT = process.cwd();
const shim = readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8");
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"));

const OWNER = "00000000-0000-0000-0000-00000000000a"; // clinical affairs lead, owner, not a member at first
const WRITER = "00000000-0000-0000-0000-00000000000b"; // medical writer, reviewer, created the batch
const READER = "00000000-0000-0000-0000-00000000000c"; // clinician reviewer, read-only, member
const CLINICIAN = "00000000-0000-0000-0000-00000000000d"; // clinician reviewer, reviewer, not a member
const OUTSIDER = "00000000-0000-0000-0000-00000000000e"; // medical writer, reviewer, not a member
const NO_ROLE = "00000000-0000-0000-0000-00000000000f"; // has an account but no role
const BATCH = "10000000-0000-0000-0000-000000000001";

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

async function add(userId: string, email: string) {
  const { rows } = await asUser(userId, () =>
    db.query<{ r: string }>("select public.add_batch_member($1, $2) as r", [BATCH, email]),
  );
  return rows[0].r;
}

async function remove(userId: string, memberId: string) {
  const { rows } = await asUser(userId, () =>
    db.query<{ r: string }>("select public.remove_batch_member($1, $2) as r", [BATCH, memberId]),
  );
  return rows[0].r;
}

async function canSeeBatch(userId: string) {
  const { rows } = await asUser(userId, () => db.query("select id from public.batches where id = $1", [BATCH]));
  return rows.length === 1;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  for (const sql of migrations) {
    await db.exec(sql);
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'lead@example.com'),
      ('${WRITER}', 'writer@example.com'),
      ('${READER}', 'reader@example.com'),
      ('${CLINICIAN}', 'clinician@example.com'),
      ('${OUTSIDER}', 'outsider@example.com'),
      ('${NO_ROLE}', 'norole@example.com');
    insert into public.user_roles (user_id, user_type, permission_level) values
      ('${OWNER}', 'clinical_affairs_lead', 'owner'),
      ('${WRITER}', 'medical_writer', 'reviewer'),
      ('${READER}', 'clinician_reviewer', 'read_only'),
      ('${CLINICIAN}', 'clinician_reviewer', 'reviewer'),
      ('${OUTSIDER}', 'medical_writer', 'reviewer');
    -- The creator becomes a member through the trigger.
    insert into public.batches (id, name, source_label, created_by) values
      ('${BATCH}', 'Shared batch', 'public', '${WRITER}');
    insert into public.batch_members (batch_id, user_id) values ('${BATCH}', '${READER}');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("can_manage_batch", () => {
  it("is true for the batch's creator, and false for a read-only member or an owner who is not a member", async () => {
    const check = (userId: string) =>
      asUser(userId, () => db.query<{ r: boolean }>("select public.can_manage_batch($1) as r", [BATCH]));
    expect((await check(WRITER)).rows[0].r).toBe(true);
    expect((await check(READER)).rows[0].r).toBe(false);
    expect((await check(OWNER)).rows[0].r).toBe(false);
  });
});

describe("add_batch_member", () => {
  it("lets the creator add someone by email, ignoring case and spaces, and gives them access", async () => {
    expect(await canSeeBatch(CLINICIAN)).toBe(false);
    expect(await add(WRITER, "  Clinician@Example.com ")).toBe("ok");
    expect(await canSeeBatch(CLINICIAN)).toBe(true);
  });

  it("says when the person is already a member", async () => {
    expect(await add(WRITER, "clinician@example.com")).toBe("already_member");
  });

  it("refuses an email with no account, and an account with no role, in the same way", async () => {
    expect(await add(WRITER, "nobody@example.com")).toBe("unknown_user");
    expect(await add(WRITER, "norole@example.com")).toBe("unknown_user");
  });

  it("refuses a read-only member, and audits it", async () => {
    expect(await add(READER, "outsider@example.com")).toBe("denied");
    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'batch.add_member'",
      [READER],
    );
    expect(audit.rows).toEqual([{ allowed: false }]);
  });

  it("refuses someone who is not a member, even an owner", async () => {
    expect(await add(OUTSIDER, "outsider@example.com")).toBe("denied");
    expect(await add(OWNER, "outsider@example.com")).toBe("denied");
  });

  it("lets an owner manage the batch once they are a member", async () => {
    expect(await add(WRITER, "lead@example.com")).toBe("ok");
    expect(await add(OWNER, "outsider@example.com")).toBe("ok");
  });
});

describe("batch_member_details", () => {
  it("lists every member with their email and role, the creator first", async () => {
    const { rows } = await asUser(READER, () =>
      db.query<{ email: string; user_type: string; permission_level: string; is_creator: boolean }>(
        "select email, user_type, permission_level, is_creator from public.batch_member_details($1)",
        [BATCH],
      ),
    );
    expect(rows[0]).toEqual({
      email: "writer@example.com",
      user_type: "medical_writer",
      permission_level: "reviewer",
      is_creator: true,
    });
    expect(rows.map((row) => row.email).sort()).toEqual([
      "clinician@example.com",
      "lead@example.com",
      "outsider@example.com",
      "reader@example.com",
      "writer@example.com",
    ]);
  });

  it("returns nothing to someone who is not a member", async () => {
    const { rows } = await asUser(NO_ROLE, () =>
      db.query("select email from public.batch_member_details($1)", [BATCH]),
    );
    expect(rows).toEqual([]);
  });
});

describe("remove_batch_member", () => {
  it("lets the creator remove a member, which takes away their access", async () => {
    expect(await remove(WRITER, CLINICIAN)).toBe("ok");
    expect(await canSeeBatch(CLINICIAN)).toBe(false);
  });

  it("says when the person is not a member", async () => {
    expect(await remove(WRITER, CLINICIAN)).toBe("not_member");
  });

  it("never removes the creator, even for an owner", async () => {
    expect(await remove(OWNER, WRITER)).toBe("creator");
    expect(await canSeeBatch(WRITER)).toBe(true);
  });

  it("refuses a read-only member, and audits it", async () => {
    expect(await remove(READER, OUTSIDER)).toBe("denied");
    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'batch.remove_member'",
      [READER],
    );
    expect(audit.rows).toEqual([{ allowed: false }]);
  });

  it("refuses a direct insert or delete on the membership table", async () => {
    await expect(
      asUser(WRITER, () =>
        db.query("insert into public.batch_members (batch_id, user_id) values ($1, $2)", [BATCH, NO_ROLE]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(WRITER, () => db.query("delete from public.batch_members where user_id = $1", [READER])),
    ).rejects.toThrow(/permission denied/);
  });
});
