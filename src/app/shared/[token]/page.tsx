import { createHash } from "node:crypto";
import { Suspense } from "react";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SHARE_TOKEN, isOk, type Refusal, type ReviewLog } from "@/lib/review-log";
import { ReviewLogView } from "@/app/_components/review-log";
import { SharedRefusal } from "@/app/_components/shared-refusal";

// A review log opened through a share link (US-13, S14, ADR-0020). The person must be signed in.
// The database checks the link (current, and for this person if it names one) and records the view.
export default function SharedReviewLogPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <SharedLog params={params} />
      </Suspense>
    </Container>
  );
}

async function SharedLog({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!SHARE_TOKEN.test(token)) return <SharedRefusal result="not_found" />;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data, error } = await supabase.rpc("review_log", { p_token_hash: tokenHash });
  if (error) {
    console.error("review_log (shared) failed:", error.message);
    return <Alert severity="error">Could not load the review log. Try again.</Alert>;
  }
  const log = data as ReviewLog | Refusal | null;
  if (!isOk(log)) return <SharedRefusal result={log?.result ?? "not_found"} />;

  return (
    <ReviewLogView
      log={log}
      crumbs={[{ label: "Shared review log" }]}
      recordHref={(pmid) => `/shared/${token}/records/${pmid}`}
    />
  );
}
