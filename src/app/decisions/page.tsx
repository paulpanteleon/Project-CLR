import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OUTCOME_LABELS, UNDECIDED, hasFilters, outcomeLabel, parseFilters } from "@/lib/decisions";
import { FilterForm, type FilterOption } from "./filter-form";

// Shown per search. One more is asked for, to tell whether there are more than this.
const SHOWN = 100;

type ResultRow = {
  batch_id: string;
  batch_name: string;
  pmid: string;
  title: string;
  authors: string | null;
  year: number | null;
  outcome: string | null;
  reason_code: string | null;
  decided_by: string | null;
  decided_at: string | null;
  corrections: number;
};

// Find a decision (S10, US-09, UC2): search every batch the user is a member of by PubMed ID, title
// or author, and filter by batch, outcome, reviewer or reason. Each result opens the record's
// decision detail.
export default function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Find decisions
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Searches every batch you are a member of. Open a record to see why it was decided: its AI proposals, decisions,
        corrections and the criteria applied.
      </Typography>
      <Suspense fallback={null}>
        <Results searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

// PubMed lists authors separated by semicolons. The table shows the first three.
function shortAuthors(authors: string) {
  const names = authors.split(";").map((name) => name.trim()).filter(Boolean);
  return names.length > 3 ? `${names.slice(0, 3).join("; ")} et al.` : names.join("; ");
}

function when(iso: string) {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

async function Results({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  // Row-level security limits the batches, and through them the criteria, to the user's own.
  const [{ data: batches }, { data: reviewerRows }, { data: results, error }] = await Promise.all([
    supabase.from("batches").select("id, name, criteria_version_id, created_at").order("name"),
    supabase.rpc("decision_reviewers"),
    supabase.rpc("find_decisions", {
      p_query: filters.query ?? undefined,
      p_batch_id: filters.batchId ?? undefined,
      p_outcome: filters.outcome ?? undefined,
      p_reviewer_id: filters.reviewerId ?? undefined,
      p_reason_code: filters.reasonCode ?? undefined,
      p_limit: SHOWN + 1,
    }),
  ]);

  const versionIds = [...new Set((batches ?? []).map((batch) => batch.criteria_version_id).filter((id) => id !== null))];
  const { data: reasonRows } = versionIds.length
    ? await supabase.from("criteria_reasons").select("code, label").in("criteria_version_id", versionIds).order("code")
    : { data: [] };

  // Two batches can share a name, so each option also shows when it was imported.
  const batchOptions: FilterOption[] = (batches ?? []).map((batch) => ({
    value: batch.id,
    label: `${batch.name} (${new Date(batch.created_at).toLocaleDateString("en-GB")})`,
  }));
  const outcomeOptions: FilterOption[] = [
    ...Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label })),
    { value: UNDECIDED, label: "Undecided" },
  ];
  const reviewerOptions: FilterOption[] = (reviewerRows ?? []).map((row: { user_id: string; email: string }) => ({
    value: row.user_id,
    label: row.email,
  }));
  // The same code can appear in several criteria versions. It is listed once, with its first label.
  const reasonOptions: FilterOption[] = [];
  for (const row of reasonRows ?? []) {
    if (!reasonOptions.some((option) => option.value === row.code)) {
      reasonOptions.push({ value: row.code, label: `${row.code}: ${row.label.replace(/\.$/, "")}` });
    }
  }

  const rows = (results ?? []) as ResultRow[];
  const shown = rows.slice(0, SHOWN);

  return (
    <>
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <FilterForm
          filters={filters}
          batches={batchOptions}
          outcomes={outcomeOptions}
          reviewers={reviewerOptions}
          reasons={reasonOptions}
        />
      </Paper>

      {error && <Alert severity="error">Could not search the decisions. Try again.</Alert>}

      {!error && shown.length === 0 && (
        <Alert severity="info">
          {!hasFilters(filters)
            ? "No records yet. Import a PubMed batch to start."
            : filters.query && /^[0-9]+$/.test(filters.query)
              ? "No records match. A PubMed ID must match exactly, so check the number, or clear a filter."
              : "No records match. Try fewer words or clear a filter."}
        </Alert>
      )}

      {shown.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {rows.length > SHOWN
              ? `Showing the first ${SHOWN} records. Narrow the search to see the rest.`
              : `${shown.length} ${shown.length === 1 ? "record" : "records"}. Newest decisions first, then undecided records.`}
          </Typography>
          <TableContainer component={Paper} elevation={1}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Record</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell>Decided by</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={`${row.batch_id}/${row.pmid}`} hover>
                    <TableCell sx={{ maxWidth: 420 }}>
                      <Link href={`/batches/${row.batch_id}/records/${row.pmid}`} underline="hover">
                        {row.title}
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        PMID {row.pmid}
                        {row.authors ? ` · ${shortAuthors(row.authors)}` : ""}
                        {row.year ? ` · ${row.year}` : ""}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.batch_name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={row.outcome ? "filled" : "outlined"}
                        label={outcomeLabel(row.outcome)}
                      />
                      {row.corrections > 0 && (
                        <Typography variant="caption" color="text.secondary" component="p">
                          Corrected {row.corrections === 1 ? "once" : `${row.corrections} times`}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{row.reason_code ?? "—"}</TableCell>
                    <TableCell>
                      {row.decided_by ?? "—"}
                      {row.decided_at && (
                        <Typography variant="caption" color="text.secondary" component="p">
                          {when(row.decided_at)}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </>
  );
}
