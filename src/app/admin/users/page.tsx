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

  const emails = new Map(listed.users.map((user) => [user.id, user.email ?? "No email"]));
  const rows = (roles ?? []) as RoleRow[];

  return (
    <Stack spacing={2}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {rows.length === 0 && <Alert severity="info">No users have a role yet.</Alert>}
      {rows.map((row) => (
        <Paper key={row.user_id} elevation={1} sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle1">{emails.get(row.user_id) ?? row.user_id}</Typography>
            {row.reset_requested_at && <Chip size="small" color="warning" label="Reset pending" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {USER_TYPE_LABELS[row.user_type] ?? row.user_type} · {PERMISSION_LABELS[row.permission_level] ?? row.permission_level}
          </Typography>
          <RoleForm
            userId={row.user_id}
            userType={row.user_type}
            permissionLevel={row.permission_level}
            action={setRole}
          />
          <form action={requestReset} style={{ marginTop: 16 }}>
            <input type="hidden" name="userId" value={row.user_id} />
            <Button type="submit" variant="outlined" color="warning" disabled={row.reset_requested_at !== null}>
              {row.reset_requested_at ? "Waiting for next sign-in" : "Require a new authenticator at next sign-in"}
            </Button>
          </form>
        </Paper>
      ))}
    </Stack>
  );
}
