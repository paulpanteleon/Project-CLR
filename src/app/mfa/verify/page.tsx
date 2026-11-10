import { Suspense } from "react";
import { redirect } from "next/navigation";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ENROLL } from "@/lib/auth/mfa-routing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyCode } from "../actions";
import { CodeForm } from "../code-form";
import { SignOut } from "../sign-out";

// Sign-in check (S-1). Asks for the code from the user's authenticator app.
export default function VerifyPage() {
  return (
    <Container maxWidth="xs" sx={{ py: 8 }}>
      <Paper elevation={1} sx={{ p: 4 }}>
        <Suspense fallback={null}>
          <Check />
        </Suspense>
        <SignOut />
      </Paper>
    </Container>
  );
}

async function Check() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // An admin asked for a new authenticator (US-21). This runs after the password check.
  // Remove the old authenticator, then send the user to set up a new one (ADR-0011, ADR-0012).
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return <Alert severity="error">Could not load your sign-in settings. Try again.</Alert>;
  }
  // Owners can read every role row (user_roles_read_owners), so filter to the signed-in user.
  // Without the filter, maybeSingle() fails for an owner and the reset was skipped.
  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("reset_requested_at")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (roleError) {
    console.error("user_roles lookup failed:", roleError.message);
    return <Alert severity="error">Could not load your sign-in settings. Try again.</Alert>;
  }
  if (role?.reset_requested_at) {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return <Alert severity="error">Could not reset your sign-in. Try again.</Alert>;
    }
    const userId = userData.user.id;
    const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId });
    if (listError) {
      console.error("admin listFactors failed:", listError.message);
      return <Alert severity="error">Could not reset your sign-in. Try again.</Alert>;
    }
    for (const factor of listed.factors) {
      if (factor.factor_type === "totp") {
        const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
        if (deleteError) {
          console.error("admin deleteFactor failed:", deleteError.message);
          return <Alert severity="error">Could not reset your sign-in. Try again.</Alert>;
        }
      }
    }
    redirect(ENROLL);
  }

  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    return <Alert severity="error">Could not load your sign-in settings. Try again.</Alert>;
  }

  const verified = factors.totp.find((factor) => factor.status === "verified");
  if (!verified) {
    redirect(ENROLL);
  }

  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        Enter your code
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Open your authenticator app and enter the 6-digit code for Project CLR.
      </Typography>
      <CodeForm action={verifyCode} factorId={verified.id} submitLabel="Continue" />
    </>
  );
}
