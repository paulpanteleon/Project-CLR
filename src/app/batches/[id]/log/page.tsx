import { Suspense } from "react";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOk, type Refusal, type ReviewLog } from "@/lib/review-log";
import { ReviewLogView } from "@/app/_components/review-log";
import { when } from "@/app/_components/record-detail";
import { ShareForm } from "./share-form";
import { RevokeShareButton } from "./revoke-share-button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ShareRow = {
  id: string;
  recipient_email: string | null;
  status: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  views: number;
  last_viewed_at: string | null;
};

const STATUS_LABELS: Record<string, { label: string; color: "success" | "default" | "warning" }> = {
  active: { label: "Active", color: "success" },
  expired: { label: "Expired", color: "default" },
  revoked: { label: "Withdrawn", color: "warning" },
};

// A batch's review log for its members (US-13, S14), with the share links for people who can
// manage the batch. The database checks membership and records each view (ADR-0020).
export default function BatchReviewLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Suspense fallback={null}>
        <Log params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Log({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error: errorMessage, notice } = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <Alert severity="warning">Sign-in is not set up. Check .env.local.</Alert>;
  }

  const [{ data, error }, { data: canManage }] = await Promise.all([
    supabase.rpc("review_log", { p_batch_id: id }),
    supabase.rpc("can_manage_batch", { p_batch_id: id }),
  ]);
  if (error) {
    console.error("review_log failed:", error.message);
    return <Alert severity="error">Could not load the review log. Try again.</Alert>;
  }
  const log = data as ReviewLog | Refusal | null;
  if (!isOk(log)) notFound();

  return (
    <ReviewLogView
      log={log}
      crumbs={[
        { label: "Batches", href: "/batches" },
        { label: log.batch.name, href: `/batches/${id}/summary` },
        { label: "Review log" },
      ]}
      recordHref={(pmid) => `/batches/${id}/records/${pmid}`}
    >
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      {canManage === true && <ShareSection batchId={id} />}
    </ReviewLogView>
  );
}

async function ShareSection({ batchId }: { batchId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase.rpc("review_log_shares_for_batch", { p_batch_id: batchId })
    : { data: [] };
  const shares = (data ?? []) as ShareRow[];

  return (
    <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Share this review log
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        People you share with must sign in. They can read this log and each record&apos;s history, and nothing else in
        the batch. Every page they open is recorded in the audit history.
      </Typography>
      <ShareForm batchId={batchId} />

      {shares.length > 0 && (
        <TableContainer sx={{ mt: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Shared with</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Pages opened</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shares.map((share) => {
                const status = STATUS_LABELS[share.status] ?? { label: share.status, color: "default" as const };
                const recipient = share.recipient_email ?? "Open link";
                return (
                  <TableRow key={share.id}>
                    <TableCell>{recipient}</TableCell>
                    <TableCell>
                      <Chip size="small" label={status.label} color={status.color} />
                    </TableCell>
                    <TableCell>{when(share.expires_at)}</TableCell>
                    <TableCell>
                      {share.created_by}
                      <Typography variant="caption" color="text.secondary" component="p">
                        {when(share.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {share.views}
                      {share.last_viewed_at && (
                        <Typography variant="caption" color="text.secondary" component="p">
                          Last {when(share.last_viewed_at)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {share.status === "active" && (
                        <RevokeShareButton batchId={batchId} shareId={share.id} recipient={share.recipient_email} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
