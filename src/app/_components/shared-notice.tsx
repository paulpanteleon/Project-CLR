import Alert from "@mui/material/Alert";
import type { ShareInfo } from "@/lib/review-log";

// Shown on pages opened through a share link: how the person got access, until when, and that
// their views are recorded (US-13).
export function SharedNotice({ share }: { share: NonNullable<ShareInfo> }) {
  const expires = `${new Date(share.expires_at).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      Read-only. Shared with you {share.named ? "by name" : "by link"}, until {expires}. Each page you open is recorded in
      the audit history.
    </Alert>
  );
}
