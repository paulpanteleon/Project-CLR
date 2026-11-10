import { Suspense } from "react";
import { redirect } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestReset, setRole } from "../actions";
import { PERMISSION_LABELS, RoleForm, USER_TYPE_LABELS } from "../role-form";

// Users and roles (US-15, US-21). Owners only. The page checks the caller is an owner
// before it reads the user list (ADR-0012).
export default function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Users and roles
      </Typography>
      <Suspense fallback={null}>
        <UserList searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

type RoleRow = {
  user_id: string;
  user_type: string;
  permission_level: string;
  reset_requested_at: string | null;
};

async function UserList({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: errorMessage } = await searchParams;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const { data: isOwner } = await supabase.rpc("is_owner");
  if (!isOwner) {
    redirect("/");
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return <Alert severity="warning">The admin key is not set. Add SUPABASE_SECRET_KEY to .env.local.</Alert>;
  }

  const [{ data: roles, error: rolesError }, { data: listed, error: listError }] = await Promise.all([
    supabase.from("user_roles").select("user_id, user_type, permission_level, reset_requested_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  if (rolesError || listError) {
    return <Alert severity="error">Could not load users. Try again.</Alert>;
  }

  // Every account is listed, including accounts with no role yet. Those are assigned a role here.
  const rolesByUser = new Map((roles ?? []).map((row) => [row.user_id, row as RoleRow]));
  const users = listed.users
    .map((user) => ({ userId: user.id, email: user.email ?? "No email", role: rolesByUser.get(user.id) ?? null }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {users.length === 0 && <Alert severity="info">No users have signed up yet.</Alert>}
      {users.map(({ userId, email, role }) => (
        <Paper key={userId} elevation={1} sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle1">{email}</Typography>
            {role ? (
              role.reset_requested_at && <Chip size="small" color="warning" label="Reset pending" />
            ) : (
              <Chip size="small" label="No role yet" />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {role
              ? `${USER_TYPE_LABELS[role.user_type] ?? role.user_type} · ${PERMISSION_LABELS[role.permission_level] ?? role.permission_level}`
              : "Not assigned. Choose a user type and permission, then save."}
          </Typography>
          <RoleForm
            userId={userId}
            userType={role?.user_type ?? "medical_writer"}
            permissionLevel={role?.permission_level ?? "read_only"}
            action={setRole}
          />
          {role && (
            <form action={requestReset} style={{ marginTop: 16 }}>
              <input type="hidden" name="userId" value={userId} />
              <Button type="submit" variant="outlined" color="warning" disabled={role.reset_requested_at !== null}>
                {role.reset_requested_at ? "Waiting for next sign-in" : "Require a new authenticator at next sign-in"}
              </Button>
            </form>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
