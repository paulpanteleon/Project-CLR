import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Import summary for one batch (S03, US-01). Counts come from the database, so they
// match what was saved, even after a refresh.
export default function ImportSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Summary params={params} />
      </Suspense>
    </Container>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <Paper elevation={1} sx={{ p: 2, flex: 1, textAlign: "center" }}>
      <Typography variant="h4" component="p">
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

async function Summary({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Row-level security limits these to the batch's members. Anyone else gets nothing.
  const { data: batch } = await supabase.from("batches").select("id, name").eq("id", id).maybeSingle();
  if (!batch) notFound();

  const { data: file } = await supabase
    .from("source_snapshots")
    .select("rejected_count, duplicate_count")
    .eq("batch_id", id)
    .maybeSingle();

  const { data: records, error } = await supabase
    .from("records")
    .select("pmid, abstract")
    .eq("batch_id", id)
    .order("pmid");

  if (error) {
    return <Alert severity="error">Could not load the import summary. Try again.</Alert>;
  }

  const flagged = (records ?? []).filter((r) => !r.abstract);

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Import summary: {batch.name}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ my: 3 }}>
        <Count label="Accepted" value={records?.length ?? 0} />
        <Count label="Flagged" value={flagged.length} />
        <Count label="Duplicates" value={file?.duplicate_count ?? 0} />
        <Count label="Rejected" value={file?.rejected_count ?? 0} />
      </Stack>

      {flagged.length > 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Flagged records
          </Typography>
          {flagged.map((r) => (
            <Typography key={r.pmid} variant="body2">
              PMID {r.pmid}: no abstract available. You can still screen it from the title.
            </Typography>
          ))}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between" }}>
        <Button href="/" color="inherit">
          Back to batches
        </Button>
        <Button variant="contained" disabled>
          Continue to batch setup
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Batch setup is not built yet.
      </Typography>
    </>
  );
}
