import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { confirmEnrollment } from "../actions";
import { CodeForm } from "../code-form";
import { SignOut } from "../sign-out";

// Multi-factor setup (S-1). Shows a QR code for an authenticator app, then asks
// for the first code to confirm it.
export default function EnrollPage() {
  return (
    <Container maxWidth="xs" sx={{ py: 8 }}>
      <Paper elevation={1} sx={{ p: 4 }}>
        <Suspense fallback={null}>
          <Enrolment />
        </Suspense>
        <SignOut />
      </Paper>
    </Container>
  );
}

async function Enrolment() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Remove any unfinished set-up first, so only one QR code is ever waiting.
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    return <Alert severity="error">Could not load your sign-in settings. Try again.</Alert>;
  }
  for (const factor of factors.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (error || !data) {
    return <Alert severity="error">Could not start set-up. Try again.</Alert>;
  }

  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        Set up your authenticator
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Scan this code with an authenticator app (for example, Google Authenticator or
        Microsoft Authenticator). Then enter the 6-digit code it shows.
      </Typography>
      <Box
        component="img"
        src={data.totp.qr_code}
        alt="QR code to add this account to your authenticator app"
        sx={{ display: "block", mx: "auto", width: 200, height: 200, mb: 2 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, wordBreak: "break-all" }}>
        Cannot scan? Enter this key instead: <code>{data.totp.secret}</code>
      </Typography>
      <CodeForm action={confirmEnrollment} factorId={data.id} submitLabel="Confirm" />
    </>
  );
}
