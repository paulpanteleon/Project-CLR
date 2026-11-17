"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { revokeShareLink } from "./actions";

// Withdraws a share link after the user confirms in a dialog (ADR-0020).
export function RevokeShareButton({
  batchId,
  shareId,
  recipient,
}: {
  batchId: string;
  shareId: string;
  recipient: string | null;
}) {
  const [open, setOpen] = useState(false);
  const titleId = `revoke-${shareId}-title`;

  return (
    <>
      <Button size="small" color="error" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby={titleId}>
        <form action={revokeShareLink}>
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="shareId" value={shareId} />
          <DialogTitle id={titleId}>{recipient ? `Withdraw the link for ${recipient}?` : "Withdraw the open link?"}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              The link stops working straight away. This can&apos;t be undone, but you can create a new link at any time.
              Views already made stay in the audit history.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" color="error" variant="contained">
              Withdraw
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
