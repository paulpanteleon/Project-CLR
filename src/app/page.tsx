import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignOut } from "./mfa/sign-out";

// Batches screen (S01). Lists the batches the user can see, and starts an import.
export default function Home() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h4" component="h1">
          Batches
        </Typography>
        <Button href="/import" variant="contained">
          Import PubMed batch
        </Button>
      </Stack>
      {/* The user and their batches are read from the request's cookies, so that part is
          streamed inside Suspense and the rest of the page can be built ahead of time. */}
      <Suspense fallback={null}>
        <SignedInAs />
        <BatchList />
      </Suspense>
      <SignOut />
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

async function BatchList() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Row-level security returns only the batches this user is a member of.
  const { data: batches, error } = await supabase
    .from("batches")
    .select("id, name, source_label, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <Alert severity="error">Could not load your batches. Try again.</Alert>;
  }

  if (!batches || batches.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 3 }}>
        No batches yet. Import a PubMed export file to start one.
      </Alert>
    );
  }

  return (
    <Paper elevation={1} sx={{ mt: 3 }}>
      <List>
        {batches.map((batch) => (
          <ListItemButton key={batch.id} href={`/batches/${batch.id}/summary`}>
            <ListItemText
              primary={batch.name}
              secondary={`${batch.source_label} · ${batch.status} · ${new Date(batch.created_at).toLocaleDateString("en-GB")}`}
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}
