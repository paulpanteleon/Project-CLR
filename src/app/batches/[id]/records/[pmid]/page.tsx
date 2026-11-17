import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOk, type RecordDetail, type Refusal } from "@/lib/review-log";
import { RecordDetailView } from "@/app/_components/record-detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PMID = /^[0-9]+$/;

// Decision detail for a member of the batch (S11, US-10). The database checks membership and records
// the view in the audit history (ADR-0020). Anyone else gets a not-found page.
export default function RecordDecisionPage({ params }: { params: Promise<{ id: string; pmid: string }> }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Detail params={params} />
      </Suspense>
    </Container>
  );
}

async function Detail({ params }: { params: Promise<{ id: string; pmid: string }> }) {
  const { id, pmid } = await params;
  if (!UUID.test(id) || !PMID.test(pmid)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const { data, error } = await supabase.rpc("record_decision_detail", { p_batch_id: id, p_pmid: pmid });
  if (error) {
    console.error("record_decision_detail failed:", error.message);
    return <Alert severity="error">Could not load this record. Try again.</Alert>;
  }
  const detail = data as RecordDetail | Refusal | null;
  if (!isOk(detail)) notFound();

  return (
    <RecordDetailView
      detail={detail}
      crumbs={[
        { label: "Find decisions", href: "/decisions" },
        { label: detail.batch.name, href: `/batches/${id}/summary` },
        { label: "Review log", href: `/batches/${id}/log` },
        { label: `PMID ${pmid}` },
      ]}
      screenHref={`/batches/${id}/screen`}
    />
  );
}
