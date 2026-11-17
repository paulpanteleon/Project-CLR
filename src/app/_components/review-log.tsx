import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { MODELS } from "@/lib/ai/openrouter";
import { OUTCOME_LABELS, outcomeLabel } from "@/lib/decisions";
import type { ReviewLog } from "@/lib/review-log";
import { when, type Crumb } from "./record-detail";
import { SharedNotice } from "./shared-notice";

// The read-only review log for one batch (US-13, S14): the criteria applied, a count of outcomes,
// and every record's current decision with its reason, supporting text, reviewer and the AI
// proposals. Each record opens its full history. Members and people with a share link see the same
// log (ADR-0020).
export function ReviewLogView({
  log,
  crumbs,
  recordHref,
  children,
}: {
  log: ReviewLog;
  crumbs: Crumb[];
  recordHref: (pmid: string) => string;
  // Shown under the title, before the log: messages and share links on the members' page.
  children?: ReactNode;
}) {
  const { batch, criteria_version: version, records } = log;
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = record.outcome ?? "undecided";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const modelLabel = (modelId: string) => MODELS.find((model) => model.id === modelId)?.label ?? modelId;

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

      {log.share && <SharedNotice share={log.share} />}

      <Typography variant="h4" component="h1" gutterBottom>
        Review log: {batch.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A {batch.source_label} batch, {batch.status}, imported {when(batch.created_at)}. Read-only. Open a record to see
        its full history.
      </Typography>

      {children}

      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Criteria applied
        </Typography>
        {version ? (
          <Stack spacing={0.5}>
            <Typography variant="body2">
              <strong>
                {version.review_name}, version {version.version_number}
              </strong>{" "}
              ({version.status}
              {version.approved_at ? `, approved ${when(version.approved_at)}` : ""})
            </Typography>
            {version.reasons.map((reason) => (
              <Typography key={reason.code} variant="body2" color="text.secondary">
                {reason.code}: {reason.label}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            This batch has no criteria version yet.
          </Typography>
        )}
      </Paper>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
        <Chip label={`${records.length} records`} />
        {[...Object.keys(OUTCOME_LABELS), "undecided"].map((outcome) => (
          <Chip
            key={outcome}
            variant="outlined"
            label={`${outcome === "undecided" ? "Undecided" : outcomeLabel(outcome)}: ${counts.get(outcome) ?? 0}`}
          />
        ))}
      </Stack>

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Record</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>Reason and supporting text</TableCell>
              <TableCell>Decided by</TableCell>
              <TableCell>AI proposals</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.pmid} sx={{ verticalAlign: "top" }}>
                <TableCell sx={{ minWidth: 220, maxWidth: 360 }}>
                  <Link href={recordHref(record.pmid)} underline="hover">
                    {record.title}
                  </Link>
                  <Typography variant="body2" color="text.secondary">
                    PMID {record.pmid}
                    {record.year ? ` · ${record.year}` : ""}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" variant={record.outcome ? "filled" : "outlined"} label={outcomeLabel(record.outcome)} />
                  {record.corrections > 0 && (
                    <Typography variant="caption" color="text.secondary" component="p">
                      Corrected {record.corrections === 1 ? "once" : `${record.corrections} times`}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ minWidth: 200, maxWidth: 360 }}>
                  {record.reason_code ? (
                    <>
                      <Typography variant="body2">
                        {record.reason_code}
                        {record.reason_label ? `: ${record.reason_label.replace(/\.$/, "")}` : ""}
                      </Typography>
                      {record.supporting_text && (
                        <Typography variant="body2" color="text.secondary">
                          {record.supporting_text}
                        </Typography>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {record.decided_by ?? "—"}
                  {record.decided_at && (
                    <Typography variant="caption" color="text.secondary" component="p">
                      {when(record.decided_at)}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {record.proposals.length === 0
                    ? "—"
                    : record.proposals.map((proposal) => (
                        <Box key={proposal.model_id}>
                          <Typography variant="caption">
                            {modelLabel(proposal.model_id)}:{" "}
                            {proposal.status === "proposed"
                              ? `${outcomeLabel(proposal.outcome)}, ${proposal.reason_code}`
                              : "unreadable reply"}
                          </Typography>
                        </Box>
                      ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
