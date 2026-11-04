import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Batches screen (S01). It shows the signed-in user and an empty list for now.
// Batch data is added once the import and screening features are built.
export default function Home() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Batches
      </Typography>
      {/* The user is read from the request's cookies, so that part is streamed
          inside Suspense and the rest of the page can be built ahead of time. */}
      <Suspense fallback={null}>
        <SignedInAs />
      </Suspense>
      <Box sx={{ mt: 3 }}>
        <Alert severity="info">No batches yet. Importing a PubMed file comes next.</Alert>
      </Box>
    </Container>
  );
}

async function SignedInAs() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!data.user?.email) return null;

  return (
    <Typography variant="body2" color="text.secondary" gutterBottom>
      Signed in as {data.user.email}
    </Typography>
  );
}
