import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/ai/openrouter";
import {
  buildHistory,
  currentDecision,
  outcomeLabel,
  type HistoryEvent,
  type HistoryItem,
  type HistoryProposal,
} from "@/lib/decisions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PMID = /^[0-9]+$/;

type Proposal = HistoryProposal & {
  criteria_version_id: string;
  prompt_version: string;
  settings: unknown;
  raw_output: string;
  upstream_provider: string;
  route_tag: string;
  zdr_enforced: boolean;
  data_region_reported: string | null;
  generation_id: string;
  actor_id: string;
};

type CriteriaVersion = {
  id: string;
  review_name: string;
  version_number: number;
  status: string;
  review_topic: string;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  design: string;
  dates: string;
  approved_at: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  human_decision: "Decision",
  correction: "Correction",
  override: "Override",
  query: "Query",
  query_response: "Query response",
  dispute_flag: "Disagreement flag",
  resolution: "Resolution",
};

// Decision detail (S11, US-10, UC2): everything needed to answer "why was this record decided this
// way?" on one page. The current outcome, the record as it was screened, every AI proposal with its
// reproducibility set, every decision and correction in order, and the criteria version applied.
export default function RecordDecisionPage({ params }: { params: Promise<{ id: string; pmid: string }> }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Detail params={params} />
      </Suspense>
    </Container>
  );
}

function when(iso: string) {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

async function Detail({ params }: { params: Promise<{ id: string; pmid: string }> }) {
  const { id, pmid } = await params;
  if (!UUID.test(id) || !PMID.test(pmid)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Row-level security limits every read to the batch's members. Anyone else gets a not-found page.
  const [{ data: batch }, { data: record }] = await Promise.all([
    supabase.from("batches").select("id, name, source_label, status, criteria_version_id").eq("id", id).maybeSingle(),
    supabase
      .from("records")
      .select("pmid, doi, title, abstract, authors, journal, year, source_snapshot_id")
      .eq("batch_id", id)
      .eq("pmid", pmid)
      .maybeSingle(),
  ]);
  if (!batch || !record) notFound();

  const [{ data: eventRows }, { data: proposalRows }, { data: people }, { data: file }] = await Promise.all([
    supabase
      .from("decision_events")
      .select("id, kind, outcome, reason_code, free_text, actor_id, recorded_at, corrects_event_id, criteria_version_id")
      .eq("batch_id", id)
      .eq("record_pmid", pmid)
      .order("recorded_at"),
    supabase
      .from("ai_proposals")
      .select(
        "id, model_id, status, outcome, reason_code, rationale, created_at, criteria_version_id, prompt_version, settings, raw_output, upstream_provider, route_tag, zdr_enforced, data_region_reported, generation_id, actor_id",
      )
      .eq("batch_id", id)
      .eq("record_pmid", pmid)
      .order("created_at"),
    supabase.rpc("batch_people", { p_batch_id: id }),
    supabase.from("source_snapshots").select("file_name, uploaded_at").eq("id", record.source_snapshot_id).maybeSingle(),
  ]);

  const events = (eventRows ?? []) as (HistoryEvent & { criteria_version_id: string | null })[];
  const proposals = (proposalRows ?? []) as Proposal[];
  const current = currentDecision(events);

  // The criteria version the record was decided under, or the batch's version if it is undecided.
  const versionId =
    (current as (HistoryEvent & { criteria_version_id: string | null }) | null)?.criteria_version_id ??
    batch.criteria_version_id;
  const [{ data: version }, { data: reasonRows }] = versionId
    ? await Promise.all([
        supabase
          .from("criteria_versions")
          .select(
            "id, review_name, version_number, status, review_topic, population, intervention, comparator, outcomes, design, dates, approved_at",
          )
          .eq("id", versionId)
          .maybeSingle(),
        supabase.from("criteria_reasons").select("code, label").eq("criteria_version_id", versionId).order("code"),
      ])
    : [{ data: null }, { data: [] }];

  const emails = new Map<string, string>(
    (people ?? []).map((person: { user_id: string; email: string }) => [person.user_id, person.email]),
  );
  const person = (userId: string) => emails.get(userId) ?? "a former user";
  const reasonLabel = new Map<string, string>((reasonRows ?? []).map((row) => [row.code, row.label]));
  const reason = (code: string | null) =>
    code ? `${code}${reasonLabel.has(code) ? `: ${reasonLabel.get(code)?.replace(/\.$/, "")}` : ""}` : "—";
  const modelLabel = (modelId: string) => MODELS.find((model) => model.id === modelId)?.label ?? modelId;
  const history = buildHistory(events, proposals);

  return (
    <>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link href="/decisions" underline="hover" color="inherit">
          Find decisions
        </Link>
        <Link href={`/batches/${id}/summary`} underline="hover" color="inherit">
          {batch.name}
        </Link>
        <Typography color="text.primary">PMID {pmid}</Typography>
      </Breadcrumbs>

      <Typography variant="h5" component="h1" gutterBottom>
        {record.title}
      </Typography>

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Current outcome
        </Typography>
        {current ? (
          <Stack spacing={1}>
            <Box>
              <Chip label={outcomeLabel(current.outcome)} color="primary" />
            </Box>
            <Typography variant="body2">
              <strong>Reason:</strong> {reason(current.reason_code)}
            </Typography>
            {current.free_text && (
              <Typography variant="body2">
                <strong>Supporting text:</strong> {current.free_text}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {current.kind === "correction" ? "Corrected" : "Decided"} by {person(current.actor_id)} at{" "}
              {when(current.recorded_at)}
              {version ? `, under ${version.review_name}, version ${version.version_number}` : ""}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
            <Alert severity="info" sx={{ width: "100%" }}>
              Not screened yet. Nobody has recorded a decision on this record.
            </Alert>
            {batch.criteria_version_id && batch.status === "open" && (
              <Button variant="outlined" href={`/batches/${id}/screen`}>
                Screen this batch
              </Button>
            )}
          </Stack>
        )}
      </Paper>

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          History
        </Typography>
        {history.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No AI proposals or decisions yet.
          </Typography>
        ) : (
          <Stack component="ol" spacing={2} sx={{ pl: 2.5, m: 0 }}>
            {history.map((item) => (
              <HistoryEntry
                key={item.type === "proposal" ? item.proposal.id : item.event.id}
                item={item}
                person={person}
                reason={reason}
                modelLabel={modelLabel}
              />
            ))}
          </Stack>
        )}
      </Paper>

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Record as screened
        </Typography>
        <Stack spacing={1}>
          <Typography variant="body2">
            <strong>PMID:</strong>{" "}
            <Link href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`} target="_blank" rel="noopener noreferrer">
              {pmid}
            </Link>
            {record.doi ? (
              <>
                {" · "}
                <strong>DOI:</strong> {record.doi}
              </>
            ) : null}
          </Typography>
          {record.authors && (
            <Typography variant="body2">
              <strong>Authors:</strong> {record.authors}
            </Typography>
          )}
          {(record.journal || record.year) && (
            <Typography variant="body2">
              <strong>Journal:</strong> {[record.journal, record.year].filter(Boolean).join(", ")}
            </Typography>
          )}
          <Typography variant="body2">
            {record.abstract ?? <em>No abstract. The record was screened from its title.</em>}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Imported from {file?.file_name ?? "a PubMed export file"}
            {file?.uploaded_at ? ` on ${when(file.uploaded_at)}` : ""} into a {batch.source_label} batch. Records are
            never changed after import, so this is the text every reviewer and model saw.
          </Typography>
        </Stack>
      </Paper>

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Criteria applied
        </Typography>
        {version ? (
          <CriteriaDetails
            version={version as CriteriaVersion}
            reasons={reasonRows ?? []}
            currentCode={current?.reason_code ?? null}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            This batch has no criteria version yet.
          </Typography>
        )}
      </Paper>
    </>
  );
}

function HistoryEntry({
  item,
  person,
  reason,
  modelLabel,
}: {
  item: HistoryItem;
  person: (userId: string) => string;
  reason: (code: string | null) => string;
  modelLabel: (modelId: string) => string;
}) {
  if (item.type === "proposal") {
    const proposal = item.proposal as Proposal;
    return (
      <li>
        <Typography variant="subtitle2">
          AI proposal from {modelLabel(proposal.model_id)} · {when(proposal.created_at)}
        </Typography>
        {proposal.status === "proposed" ? (
          <>
            <Typography variant="body2">
              {outcomeLabel(proposal.outcome)}, {reason(proposal.reason_code)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {proposal.rationale}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            The reply could not be read, so it made no proposal. Its raw text is kept below.
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" component="p">
          A proposal, not a decision. Run by {person(proposal.actor_id)}.
        </Typography>
        <Box component="details" sx={{ mt: 0.5 }}>
          <Typography component="summary" variant="caption" sx={{ cursor: "pointer" }}>
            Reproducibility details
          </Typography>
          <Box component="dl" sx={{ m: 0, mt: 1, display: "grid", gridTemplateColumns: "max-content 1fr", gap: 0.5, columnGap: 2 }}>
            <Field label="Model ID" value={proposal.model_id} />
            <Field label="Prompt version" value={proposal.prompt_version} />
            <Field label="Route" value={proposal.route_tag} />
            <Field label="Upstream provider" value={proposal.upstream_provider} />
            <Field label="Zero data retention" value={proposal.zdr_enforced ? "Enforced" : "Not enforced"} />
            <Field
              label="Data region reported"
              value={`${proposal.data_region_reported ?? "Not reported"}. US processing on this route is not yet confirmed (R-2, ADR-0015).`}
            />
            <Field label="Generation ID" value={proposal.generation_id} />
            <Field label="Settings" value={JSON.stringify(proposal.settings)} />
          </Box>
          <Typography variant="caption" component="p" sx={{ mt: 1 }}>
            Raw output
          </Typography>
          <Box
            component="pre"
            sx={{ m: 0, p: 1, bgcolor: "action.hover", borderRadius: 1, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}
          >
            {proposal.raw_output}
          </Box>
        </Box>
      </li>
    );
  }

  const { event, corrects, comparisons } = item;
  return (
    <li>
      <Typography variant="subtitle2">
        {EVENT_LABELS[event.kind] ?? event.kind} by {person(event.actor_id)} · {when(event.recorded_at)}
      </Typography>
      {event.outcome && (
        <Typography variant="body2">
          {outcomeLabel(event.outcome)}, {reason(event.reason_code)}
        </Typography>
      )}
      {event.free_text && (
        <Typography variant="body2" color="text.secondary">
          {event.free_text}
        </Typography>
      )}
      {corrects && (
        <Typography variant="caption" color="text.secondary" component="p">
          Corrects the {(EVENT_LABELS[corrects.kind] ?? corrects.kind).toLowerCase()} made at {when(corrects.recorded_at)} (
          {outcomeLabel(corrects.outcome)}). That entry is kept unchanged.
        </Typography>
      )}
      {comparisons.map((comparison) => (
        <Typography key={comparison.model_id} variant="caption" color="text.secondary" component="p">
          {comparison.agrees
            ? `Agreed with ${modelLabel(comparison.model_id)}'s proposal.`
            : `Overrode ${modelLabel(comparison.model_id)}'s proposal (${outcomeLabel(comparison.outcome)}, ${comparison.reason_code}).`}
        </Typography>
      ))}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <Typography component="dt" variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="caption" sx={{ m: 0, wordBreak: "break-word" }}>
        {value}
      </Typography>
    </>
  );
}

function CriteriaDetails({
  version,
  reasons,
  currentCode,
}: {
  version: CriteriaVersion;
  reasons: { code: string; label: string }[];
  currentCode: string | null;
}) {
  const fields: [string, string][] = [
    ["Review topic", version.review_topic],
    ["Population", version.population],
    ["Intervention", version.intervention],
    ["Comparator", version.comparator],
    ["Outcomes", version.outcomes],
    ["Study design", version.design],
    ["Dates", version.dates],
  ];
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        <strong>
          {version.review_name}, version {version.version_number}
        </strong>{" "}
        ({version.status}
        {version.approved_at ? `, approved ${when(version.approved_at)}` : ""})
      </Typography>
      {fields.map(([label, value]) => (
        <Typography key={label} variant="body2">
          <strong>{label}:</strong> {value}
        </Typography>
      ))}
      <Typography variant="subtitle2" sx={{ pt: 1 }}>
        Reasons
      </Typography>
      <Stack component="ul" spacing={0.5} sx={{ pl: 2.5, m: 0 }}>
        {reasons.map((row) => (
          <Typography key={row.code} component="li" variant="body2" sx={{ fontWeight: row.code === currentCode ? 700 : 400 }}>
            {row.code}: {row.label}
            {row.code === currentCode ? " (the current decision's reason)" : ""}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
