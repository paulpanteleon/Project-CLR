import { Suspense, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RECENT_BATCHES = 3;

// Home page. Says what the prototype is for, links to each primary function with a count of what
// the user can see, and lists their most recent batches. The header links here from "Project CLR".
export default function HomePage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="h4" component="h1">
          Project CLR
        </Typography>
        <Chip label="Prototype" size="small" variant="outlined" />
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 640 }}>
        Screen clinical studies for device benefit-risk reviews against one documented set of criteria.
        Every decision keeps its reason and the text behind it, so it can be checked later.
      </Typography>

      {/* Counts and recent batches are read with the request's cookies, so they stream inside
          Suspense and the rest of the page can be built ahead of time. */}
      <Suspense fallback={<FunctionCards batches={null} criteria={null} />}>
        <CardsWithCounts />
      </Suspense>

      <Typography variant="h6" component="h2" sx={{ mt: 5, mb: 1 }}>
        Recent batches
      </Typography>
      <Suspense fallback={null}>
        <RecentBatches />
      </Suspense>
    </Container>
  );
}

async function CardsWithCounts() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <FunctionCards batches={null} criteria={null} />;

  // Row-level security limits both counts to what this user can see.
  const [{ count: batchCount }, { data: versions }] = await Promise.all([
    supabase.from("batches").select("id", { count: "exact", head: true }),
    supabase.from("criteria_versions").select("status"),
  ]);
  const drafts = (versions ?? []).filter((version) => version.status === "draft").length;
  const ready = (versions ?? []).length - drafts;

  return (
    <FunctionCards
      batches={batchCount ?? 0}
      criteria={versions ? { ready, drafts } : null}
    />
  );
}

function FunctionCards({
  batches,
  criteria,
}: {
  batches: number | null;
  criteria: { ready: number; drafts: number } | null;
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <FunctionCard
        title="Batches"
        summary={batches === null ? " " : `${batches} ${batches === 1 ? "batch" : "batches"}`}
        description="Import PubMed records, choose the criteria, and screen each record."
        primary={{ label: "View batches", href: "/batches" }}
        secondary={{ label: "Import PubMed batch", href: "/import" }}
      />
      <FunctionCard
        title="Criteria"
        summary={criteria === null ? " " : `${criteria.ready} approved or locked, ${criteria.drafts} ${criteria.drafts === 1 ? "draft" : "drafts"}`}
        description="Write and approve the criteria every screening decision is checked against."
        primary={{ label: "View criteria", href: "/criteria" }}
        secondary={{ label: "Draft a new version", href: "/criteria/new" }}
      />
    </Stack>
  );
}

function FunctionCard({
  title,
  summary,
  description,
  primary,
  secondary,
}: {
  title: string;
  summary: ReactNode;
  description: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}) {
  return (
    <Paper elevation={1} sx={{ p: 3, flex: 1, display: "flex", flexDirection: "column" }}>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ minHeight: "1.5em" }}>
        {summary}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1.5, mb: 2, flexGrow: 1 }}>
        {description}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button href={primary.href} variant="contained" size="small">
          {primary.label}
        </Button>
        <Button href={secondary.href} size="small">
          {secondary.label}
        </Button>
      </Stack>
    </Paper>
  );
}

async function RecentBatches() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: batches } = await supabase
    .from("batches")
    .select("id, name, source_label, status, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_BATCHES);

  if (!batches || batches.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No batches yet. Import a PubMed export file to start one.
      </Typography>
    );
  }

  return (
    <Paper elevation={1}>
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
