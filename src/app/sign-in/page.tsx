import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { supabaseConfig } from "@/lib/supabase/config";
import { SignInForm } from "./sign-in-form";

// Sign-in screen (S00).
export default function SignInPage() {
  const configured = supabaseConfig() !== null;

  return (
    <Container maxWidth="xs" sx={{ py: 8 }}>
      <Paper elevation={1} sx={{ p: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Project CLR
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Prototype. Sign in to continue.
        </Typography>
        {configured ? (
          <SignInForm />
        ) : (
          <Alert severity="warning">
            Sign-in is not set up. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.local
            (see .env.example).
          </Alert>
        )}
      </Paper>
    </Container>
  );
}
