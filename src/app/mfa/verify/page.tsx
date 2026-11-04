import { Suspense } from "react";
import { redirect } from "next/navigation";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ENROLL } from "@/lib/auth/mfa-routing";
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
