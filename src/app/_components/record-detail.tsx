import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MODELS } from "@/lib/ai/openrouter";
import { buildHistory, currentDecision, outcomeLabel, type HistoryItem } from "@/lib/decisions";
import type { CriteriaVersionDetail, DetailEvent, DetailProposal, RecordDetail } from "@/lib/review-log";
import { SharedNotice } from "./shared-notice";

const EVENT_LABELS: Record<string, string> = {
  human_decision: "Decision",
  correction: "Correction",
  override: "Override",
  query: "Query",
  query_response: "Query response",
  dispute_flag: "Disagreement flag",
  resolution: "Resolution",
};

export type Crumb = { label: string; href?: string };

export function when(iso: string) {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

// Decision detail (S11, US-10, UC2): everything needed to answer "why was this record decided this
// way?" on one page. The current outcome, every AI proposal with its reproducibility set, every
// decision and correction in order, the record as it was screened, and the criteria version applied.
// Members reach it from their batches, and others through a shared review log (ADR-0019, ADR-0020).
export function RecordDetailView({
  detail,
  crumbs,
  screenHref,
}: {
  detail: RecordDetail;
  crumbs: Crumb[];
  screenHref?: string;
}) {
  const { batch, record, file, events, proposals, criteria_version: version } = detail;
  const current = currentDecision(events) as DetailEvent | null;

  const emails = new Map<string, string>();
  for (const item of [...events, ...proposals]) {
    if (item.actor_email) emails.set(item.actor_id, item.actor_email);
  }
  const person = (userId: string) => emails.get(userId) ?? "an unknown user";
  const reasonLabel = new Map<string, string>((version?.reasons ?? []).map((row) => [row.code, row.label]));
  const reason = (code: string | null) =>
    code ? `${code}${reasonLabel.has(code) ? `: ${reasonLabel.get(code)?.replace(/\.$/, "")}` : ""}` : "—";
  const modelLabel = (modelId: string) => MODELS.find((model) => model.id === modelId)?.label ?? modelId;
  const history = buildHistory(events, proposals);

  return (
    <>
      <Breadcrumbs sx={{ mb: 2 }}>
        {crumbs.map((crumb) =>
          crumb.href ? (
            <Link key={crumb.label} href={crumb.href} underline="hover" color="inherit">
              {crumb.label}
            </Link>
          ) : (
            <Typography key={crumb.label} color="text.primary">
              {crumb.label}
            </Typography>
          ),
        )}
      </Breadcrumbs>

      {detail.share && <SharedNotice share={detail.share} />}

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
            {screenHref && batch.criteria_version_id && batch.status === "open" && (
              <Button variant="outlined" href={screenHref}>
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
            <Link href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`} target="_blank" rel="noopener noreferrer">
              {record.pmid}
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
          <CriteriaDetails version={version} currentCode={current?.reason_code ?? null} />
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
    const proposal = item.proposal as DetailProposal;
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
          <Box
            component="dl"
            sx={{ m: 0, mt: 1, display: "grid", gridTemplateColumns: "max-content 1fr", gap: 0.5, columnGap: 2 }}
          >
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

function CriteriaDetails({ version, currentCode }: { version: CriteriaVersionDetail; currentCode: string | null }) {
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
        {version.reasons.map((row) => (
          <Typography
            key={row.code}
            component="li"
            variant="body2"
            sx={{ fontWeight: row.code === currentCode ? 700 : 400 }}
          >
            {row.code}: {row.label}
            {row.code === currentCode ? " (the current decision's reason)" : ""}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
