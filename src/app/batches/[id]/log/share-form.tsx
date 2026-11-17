"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createShareLink, type ShareState } from "./actions";

const EXPIRY_LABELS: Record<number, string> = { 1: "1 day", 7: "7 days", 30: "30 days" };

// Makes a share link for the review log (S14, US-13). With an email, only that person can open it;
// without one, anyone with an account and a role can. Either way they must sign in. The new link is
// shown once, because the app keeps only a fingerprint of it.
export function ShareForm({ batchId }: { batchId: string }) {
  const [state, action, pending] = useActionState<ShareState, FormData>(createShareLink, { error: null });
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Stack spacing={2}>
      <form action={action} onSubmit={() => setCopied(false)}>
        <input type="hidden" name="batchId" value={batchId} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField
            name="email"
            type="email"
            label="Share with (email)"
            size="small"
            fullWidth
            helperText="Leave empty for an open link that anyone with an account and a role can use."
          />
          <TextField name="days" label="Works for" select size="small" defaultValue="7" sx={{ minWidth: 140 }}>
            {Object.entries(EXPIRY_LABELS).map(([days, label]) => (
              <MenuItem key={days} value={days}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={pending} sx={{ minWidth: 140 }}>
            Create link
          </Button>
        </Stack>
      </form>

      {state.error && <Alert severity="error">{state.error}</Alert>}

      {state.link && (
        <Alert severity="success">
          <Typography variant="body2" gutterBottom>
            {state.recipient ? `Link for ${state.recipient}` : "Open link"}, working for {EXPIRY_LABELS[state.days ?? 7]}.
            Copy it now: the app keeps only a fingerprint of it, so it can&apos;t show it again.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <TextField
              value={state.link}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { readOnly: true, "aria-label": "Share link" } }}
              onFocus={(event) => event.target.select()}
            />
            <Button variant="outlined" onClick={() => copy(state.link ?? "")} sx={{ minWidth: 100 }}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
