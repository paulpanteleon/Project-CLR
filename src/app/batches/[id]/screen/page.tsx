import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CorrectionForm, DecisionForm, type ReasonOption } from "./decision-forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWN_UNDECIDED = 50;

// Screening queue for one batch (S06, S07, S11, US-04, US-05, US-11). Undecided records come
// first. Each decided record shows its current outcome, reason, and full history.
export default function ScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Queue params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

type EventRow = {
  id: string;
  record_pmid: string;
  kind: string;
  outcome: string | null;
  reason_code: string | null;
  free_text: string | null;
  actor_id: string;
  recorded_at: string;
  corrects_event_id: string | null;
};

const OUTCOME_LABELS: Record<string, string> = {
  include: "Include",
  exclude: "Exclude",
  unsure: "Maybe",
  send_to_clinician: "Send to clinician",
};

function when(iso: string) {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

async function Queue({
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

  // Row-level security limits every read to the batch's members. Anyone else is turned away.
  const { data: batch } = await supabase
    .from("batches")
    .select("id, name, criteria_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!batch) notFound();

  if (!batch.criteria_version_id) {
    return (
      <>
        <Typography variant="h4" component="h1" gutterBottom>
          Screen: {batch.name}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          This batch has no criteria version yet. Choose one on the batch summary, then screen the records.
        </Alert>
        <Button href={`/batches/${id}/summary`} sx={{ mt: 2 }}>
          Go to the batch summary
        </Button>
      </>
    );
  }

  const [{ data: userData }, { data: reasonRows }, { data: records }, { data: outcomes }, { data: events }] =
    await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("criteria_reasons")
        .select("code, label")
        .eq("criteria_version_id", batch.criteria_version_id)
        .order("code"),
      supabase
        .from("records")
        .select("pmid, title, abstract, year, journal")
        .eq("batch_id", id)
        .order("pmid"),
      supabase
        .from("current_screening_outcomes")
        .select("record_pmid, event_id, outcome, reason_code, actor_id, recorded_at")
        .eq("batch_id", id),
      supabase
        .from("decision_events")
        .select("id, record_pmid, kind, outcome, reason_code, free_text, actor_id, recorded_at, corrects_event_id")
        .eq("batch_id", id)
        .in("kind", ["human_decision", "correction"])
        .order("recorded_at"),
    ]);

  const reasons: ReasonOption[] = (reasonRows ?? []).map((row) => ({ code: row.code, label: row.label }));
  const reasonLabel = new Map(reasons.map((reason) => [reason.code, reason.label]));
  const currentByPmid = new Map((outcomes ?? []).map((row) => [row.record_pmid, row]));
  const eventsByPmid = new Map<string, EventRow[]>();
  for (const event of (events ?? []) as EventRow[]) {
    const list = eventsByPmid.get(event.record_pmid) ?? [];
    list.push(event);
    eventsByPmid.set(event.record_pmid, list);
  }

  const all = records ?? [];
  const undecided = all.filter((record) => !currentByPmid.has(record.pmid));
  const decided = all.filter((record) => currentByPmid.has(record.pmid));
  const me = userData.user?.id;

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Screen: {batch.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {decided.length} decided, {undecided.length} undecided
      </Typography>

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {undecided.length === 0 && all.length > 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Every record in this batch has a decision.
        </Alert>
      )}

      <Stack spacing={2}>
        {undecided.slice(0, SHOWN_UNDECIDED).map((record) => (
          <Paper key={record.pmid} elevation={1} sx={{ p: 3 }}>
            <RecordDetails record={record} />
            <Typography variant="body2" sx={{ mt: 2, mb: 2 }} color="text.secondary">
              {record.abstract ? "Screen from the title and abstract." : "No abstract: screen from the title."}
            </Typography>
            <DecisionForm batchId={id} pmid={record.pmid} reasons={reasons} />
          </Paper>
        ))}
        {undecided.length > SHOWN_UNDECIDED && (
          <Typography variant="body2" color="text.secondary">
            Showing the first {SHOWN_UNDECIDED} of {undecided.length} undecided records. Decide these to see the next.
          </Typography>
        )}

        {decided.map((record) => {
          const current = currentByPmid.get(record.pmid);
          const history = eventsByPmid.get(record.pmid) ?? [];
          if (!current) return null;
          return (
            <Paper key={record.pmid} elevation={1} sx={{ p: 3 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <RecordDetails record={record} />
                <Chip size="small" label={OUTCOME_LABELS[current.outcome ?? ""] ?? current.outcome} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 2 }}>
                <strong>Reason:</strong> {current.reason_code} {reasonLabel.get(current.reason_code ?? "") ?? ""}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Recorded by {current.actor_id === me ? "you" : "another reviewer"} at {when(current.recorded_at)}
              </Typography>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                History
              </Typography>
              <ol style={{ marginTop: 4 }}>
                {history.map((event) => (
                  <li key={event.id}>
                    <Typography variant="body2">
                      {event.kind === "correction" ? "Correction: " : "Decision: "}
                      {OUTCOME_LABELS[event.outcome ?? ""] ?? event.outcome}, {event.reason_code}
                      {event.free_text ? `. ${event.free_text}` : ""}. {event.actor_id === me ? "You" : "Another reviewer"},{" "}
                      {when(event.recorded_at)}
                    </Typography>
                  </li>
                ))}
              </ol>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Change this decision
              </Typography>
              <CorrectionForm batchId={id} eventId={current.event_id} reasons={reasons} />
            </Paper>
          );
        })}
      </Stack>
    </>
  );
}

function RecordDetails({
  record,
}: {
  record: { pmid: string; title: string; abstract: string | null; year: number | null; journal: string | null };
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle1" component="h2">
        {record.title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        PMID {record.pmid}
        {record.journal ? ` · ${record.journal}` : ""}
        {record.year ? ` · ${record.year}` : ""}
      </Typography>
      {record.abstract && <Typography variant="body2">{record.abstract}</Typography>}
    </Stack>
  );
}
