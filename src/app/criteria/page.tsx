import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { approveCriteriaVersion, lockCriteriaVersion } from "./actions";

// Screening criteria versions (S13, US-02, US-12). Medical writers draft a version, and
// clinical affairs leads approve and lock it. The database decides what each person may do.
export default function CriteriaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h4" component="h1">
          Screening criteria
        </Typography>
        <Suspense fallback={null}>
          <DraftButton />
        </Suspense>
      </Stack>
      <Suspense fallback={null}>
        <VersionList searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function DraftButton() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data: userType } = await supabase.rpc("current_user_type");
  if (userType !== "medical_writer") return null;
  return (
    <Button href="/criteria/new" variant="contained">
      Draft a new version
    </Button>
  );
}

type Reason = { code: string; label: string };
type Version = {
  id: string;
  review_name: string;
  version_number: number;
  review_topic: string;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  design: string;
  dates: string;
  status: "draft" | "approved" | "locked";
  drafted_by: string;
  criteria_reasons: Reason[];
};

const FIELD_LABELS: [keyof Version, string][] = [
  ["review_topic", "Review topic"],
  ["population", "Population"],
  ["intervention", "Intervention"],
  ["comparator", "Comparator"],
  ["outcomes", "Outcomes"],
  ["design", "Study design"],
  ["dates", "Dates"],
];

const STATUS_LABELS: Record<Version["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  locked: "Locked",
};

async function VersionList({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: errorMessage } = await searchParams;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const [{ data: userData }, { data: userType }, { data, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("current_user_type"),
    supabase
      .from("criteria_versions")
      .select(
        "id, review_name, version_number, review_topic, population, intervention, comparator, outcomes, design, dates, status, drafted_by, criteria_reasons(code, label)",
      )
      .order("review_name")
      .order("version_number", { ascending: false }),
  ]);

  if (error) {
    console.error("criteria_versions read failed:", error.message);
    return <Alert severity="error">Could not load the criteria. Try again.</Alert>;
  }

  const versions = (data ?? []) as Version[];
  const userId = userData.user?.id;

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {versions.length === 0 && <Alert severity="info">No criteria versions are visible to you yet.</Alert>}
      {versions.map((version) => {
        const canApprove = userType === "clinical_affairs_lead" && version.drafted_by !== userId;
        const canLock = userType === "clinical_affairs_lead";
        const canEdit = version.status === "draft" && version.drafted_by === userId && userType === "medical_writer";
        return (
          <Paper key={version.id} elevation={1} sx={{ p: 3 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="h6" component="h2">
                {version.review_name}, version {version.version_number}
              </Typography>
              <Chip size="small" label={STATUS_LABELS[version.status]} color={version.status === "draft" ? "default" : "success"} />
            </Stack>

            <Stack spacing={1} sx={{ mt: 2 }}>
              {FIELD_LABELS.map(([key, label]) => (
                <Typography key={key} variant="body2">
                  <strong>{label}:</strong> {String(version[key])}
                </Typography>
              ))}
            </Stack>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Reasons
            </Typography>
            <ul style={{ marginTop: 4 }}>
              {[...version.criteria_reasons]
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((reason) => (
                  <li key={reason.code}>
                    <Typography variant="body2">
                      <code>{reason.code}</code>: {reason.label}
                    </Typography>
                  </li>
                ))}
            </ul>

            {canEdit || (canApprove && version.status === "draft") || (canLock && version.status === "approved") ? (
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                {canEdit && (
                  <Button href={`/criteria/${version.id}/edit`} variant="outlined">
                    Edit draft
                  </Button>
                )}
                {canApprove && version.status === "draft" && (
                  <form action={approveCriteriaVersion}>
                    <input type="hidden" name="criteriaVersionId" value={version.id} />
                    <Button type="submit" variant="outlined">
                      Approve
                    </Button>
                  </form>
                )}
                {canLock && version.status === "approved" && (
                  <form action={lockCriteriaVersion}>
                    <input type="hidden" name="criteriaVersionId" value={version.id} />
                    <Button type="submit" variant="outlined" color="warning">
                      Lock
                    </Button>
                  </form>
                )}
              </Stack>
            ) : null}
          </Paper>
        );
      })}
    </Stack>
  );
}
