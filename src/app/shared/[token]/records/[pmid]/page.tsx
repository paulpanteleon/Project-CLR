import { createHash } from "node:crypto";
import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SHARE_TOKEN, isOk, type RecordDetail, type Refusal } from "@/lib/review-log";
import { RecordDetailView } from "@/app/_components/record-detail";
import { SharedRefusal } from "@/app/_components/shared-refusal";

const PMID = /^[0-9]+$/;

// One record's decision detail, opened from a shared review log (US-13, ADR-0020). The database
// checks the link again and records the view.
export default function SharedRecordPage({ params }: { params: Promise<{ token: string; pmid: string }> }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <SharedRecord params={params} />
      </Suspense>
    </Container>
  );
}

async function SharedRecord({ params }: { params: Promise<{ token: string; pmid: string }> }) {
  const { token, pmid } = await params;
  if (!SHARE_TOKEN.test(token) || !PMID.test(pmid)) return <SharedRefusal result="not_found" />;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data, error } = await supabase.rpc("record_decision_detail", {
    p_batch_id: null,
    p_pmid: pmid,
    p_token_hash: tokenHash,
  });
  if (error) {
    console.error("record_decision_detail (shared) failed:", error.message);
    return <Alert severity="error">Could not load this record. Try again.</Alert>;
  }
  const detail = data as RecordDetail | Refusal | null;
  if (!isOk(detail)) return <SharedRefusal result={detail?.result ?? "not_found"} />;

  return (
    <RecordDetailView
      detail={detail}
      crumbs={[{ label: "Shared review log", href: `/shared/${token}` }, { label: `PMID ${pmid}` }]}
    />
  );
}
