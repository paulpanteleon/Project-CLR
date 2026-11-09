import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DraftForm } from "../../draft-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  criteria_reasons: { code: string; label: string }[];
};

// Edits a draft before it is approved (US-02). Only the drafter can edit it, and only while it is a draft.
// The data is read inside Suspense, as on the other pages that read the request.
export default function EditCriteriaPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <EditBody params={params} />
    </Suspense>
  );
}

async function EditBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const [{ data: userData }, { data }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("criteria_versions")
      .select(
        "id, review_name, version_number, review_topic, population, intervention, comparator, outcomes, design, dates, status, drafted_by, criteria_reasons(code, label)",
      )
      .eq("id", id)
      .maybeSingle(),
  ]);

  const version = data as Version | null;
  const editable = version !== null && version.status === "draft" && version.drafted_by === userData.user?.id;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {!editable || !version ? (
        <>
          <Typography variant="h4" component="h1" gutterBottom>
            Edit draft
          </Typography>
          <Alert severity="info" sx={{ mt: 2 }}>
            This draft cannot be edited. Only the person who drafted it can edit it, and only before it is approved.
          </Alert>
          <Button href="/criteria" variant="text" sx={{ mt: 2 }}>
            Back to criteria
          </Button>
        </>
      ) : (
        <>
          <Typography variant="h4" component="h1" gutterBottom>
            Edit draft: {version.review_name}, version {version.version_number}
          </Typography>
          <Paper elevation={1} sx={{ p: 4, mt: 2 }}>
            <DraftForm
              draftId={version.id}
              initialValues={{
                review_name: version.review_name,
                review_topic: version.review_topic,
                population: version.population,
                intervention: version.intervention,
                comparator: version.comparator,
                outcomes: version.outcomes,
                design: version.design,
                dates: version.dates,
                reasons: [...version.criteria_reasons]
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((reason) => `${reason.code}: ${reason.label}`)
                  .join("\n"),
              }}
            />
          </Paper>
        </>
      )}
    </Container>
  );
}
