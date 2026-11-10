import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CriteriaSelect, type CriteriaOption } from "./criteria-select";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Import summary for one batch (S03, US-01), with batch setup (S04, US-02). Counts come from the
// database, so they match what was saved, even after a refresh.
export default function ImportSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Summary params={params} searchParams={searchParams} />
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

async function Summary({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: errorMessage } = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Row-level security limits these to the batch's members. Anyone else gets nothing.
  const { data: batch } = await supabase
    .from("batches")
    .select("id, name, criteria_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!batch) notFound();

  // Approved and locked versions are visible to everyone with a role (RLS on criteria_versions).
  const [{ data: versions }, { count: decisionCount }] = await Promise.all([
    supabase
      .from("criteria_versions")
      .select("id, review_name, version_number, status")
      .neq("status", "draft")
      .order("review_name")
      .order("version_number", { ascending: false }),
    supabase.from("decision_events").select("id", { count: "exact", head: true }).eq("batch_id", id),
  ]);
  const options: CriteriaOption[] = (versions ?? []).map((version) => ({
    id: version.id,
    label: `${version.review_name}, version ${version.version_number}`,
  }));

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

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Criteria
        </Typography>
        <CriteriaSelect
          batchId={id}
          options={options}
          currentId={batch.criteria_version_id}
          locked={(decisionCount ?? 0) > 0}
        />
      </Paper>

      <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between" }}>
        <Button href="/" color="inherit">
          Back to batches
        </Button>
        <Button variant="contained" href={`/batches/${id}/screen`} disabled={!batch.criteria_version_id}>
          Screen records
        </Button>
      </Stack>
      {!batch.criteria_version_id && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Choose a criteria version before screening.
        </Typography>
      )}
    </>
  );
}
