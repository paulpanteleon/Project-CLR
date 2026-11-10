import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for admin role changes and authenticator resets (US-15, US-21, ADR-0012).
// They run the real migrations against PGlite, with the Supabase stand-in from
// supabase-shim.sql. Each test signs in as a user the same way Supabase does.

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

async function roleOf(userId: string) {
  const { rows } = await db.query<{ user_type: string; permission_level: string; reset_requested_at: string | null }>(
    "select user_type, permission_level, reset_requested_at from public.user_roles where user_id = $1",
    [userId],
  );
  return rows[0];
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

describe("admin_set_role", () => {
  it("is refused for a non-owner, leaves the role alone, and is audited", async () => {
    const result = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.admin_set_role($1, 'medical_writer', 'owner') as r", [READER]),
    );
    expect(result.rows[0].r).toBe("denied");
    expect((await roleOf(READER)).permission_level).toBe("read_only");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'admin.set_role'",
      [WRITER],
    );
    expect(audit.rows.some((row) => row.allowed === false)).toBe(true);
  });

  it("lets an owner change a role, and audits the change", async () => {
    const result = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.admin_set_role($1, 'clinician_reviewer', 'reviewer') as r", [READER]),
    );
    expect(result.rows[0].r).toBe("ok");

    const role = await roleOf(READER);
    expect(role.user_type).toBe("clinician_reviewer");
    expect(role.permission_level).toBe("reviewer");

    const audit = await db.query<{ allowed: boolean }>(
      "select allowed from public.audit_events where actor_id = $1 and action = 'admin.set_role' and target = $2",
      [OWNER, READER],
    );
    expect(audit.rows).toEqual([{ allowed: true }]);
  });

  it("refuses to leave the batch with no owner", async () => {
    const result = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.admin_set_role($1, 'clinical_affairs_lead', 'reviewer') as r", [OWNER]),
    );
    expect(result.rows[0].r).toBe("last_owner");
    expect((await roleOf(OWNER)).permission_level).toBe("owner");
  });

  it("allows a second owner, after which the first can step down", async () => {
    const promoted = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.admin_set_role($1, 'medical_writer', 'owner') as r", [WRITER]),
    );
    expect(promoted.rows[0].r).toBe("ok");

    const stepDown = await asUser(OWNER, () =>
      db.query<{ r: string }>("select public.admin_set_role($1, 'clinical_affairs_lead', 'reviewer') as r", [OWNER]),
    );
    expect(stepDown.rows[0].r).toBe("ok");
    expect((await roleOf(OWNER)).permission_level).toBe("reviewer");
  });

  it("rejects an unknown user type or permission level", async () => {
    await expect(
      asUser(WRITER, () =>
        db.query("select public.admin_set_role($1, 'administrator', 'owner')", [READER]),
      ),
    ).rejects.toThrow(/Unknown user type/);
    await expect(
      asUser(WRITER, () =>
        db.query("select public.admin_set_role($1, 'medical_writer', 'admin')", [READER]),
      ),
    ).rejects.toThrow(/Unknown permission level/);
  });
});

describe("owners reading roles", () => {
  it("lets an owner read every role, and others read only their own", async () => {
    const asOwner = await asUser(WRITER, () =>
      db.query<{ user_id: string }>("select user_id from public.user_roles"),
    );
    // WRITER is an owner by now (promoted above), so it sees all rows.
    expect(asOwner.rows.length).toBe(3);

    const asReader = await asUser(READER, () =>
      db.query<{ user_id: string }>("select user_id from public.user_roles"),
    );
    expect(asReader.rows).toEqual([{ user_id: READER }]);
  });

  it("does not let anyone change a role row directly", async () => {
    await expect(
      asUser(READER, () =>
        db.query("update public.user_roles set permission_level = 'owner' where user_id = $1", [READER]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("authenticator reset", () => {
  it("is refused for a non-owner", async () => {
    const result = await asUser(READER, () =>
      db.query<{ r: string }>("select public.admin_request_reset($1) as r", [WRITER]),
    );
    expect(result.rows[0].r).toBe("denied");
    expect((await roleOf(WRITER)).reset_requested_at).toBeNull();
  });

  it("marks a user for reset when an owner asks, and reports an unknown user", async () => {
    // WRITER is an owner by now (see the role tests above).
    const marked = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.admin_request_reset($1) as r", [READER]),
    );
    expect(marked.rows[0].r).toBe("ok");
    expect((await roleOf(READER)).reset_requested_at).not.toBeNull();

    const missing = await asUser(WRITER, () =>
      db.query<{ r: string }>("select public.admin_request_reset(gen_random_uuid()) as r"),
    );
    expect(missing.rows[0].r).toBe("not_found");
  });

  it("is cleared for the signed-in user only, once they complete a new set-up", async () => {
    // A mark on another user, which must survive.
    await asUser(WRITER, () => db.query("select public.admin_request_reset($1)", [OWNER]));

    await asUser(READER, () => db.query("select public.complete_authenticator_reset()"));
    expect((await roleOf(READER)).reset_requested_at).toBeNull();
    expect((await roleOf(OWNER)).reset_requested_at).not.toBeNull();
  });
});
