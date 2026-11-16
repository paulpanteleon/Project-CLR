"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { removeBatchMember } from "../../actions";

// Removes a person from the batch after the user confirms in a dialog (ADR-0016).
export function RemoveMemberButton({ batchId, userId, email }: { batchId: string; userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const titleId = `remove-${userId}-title`;

  return (
    <>
      <Button size="small" color="error" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby={titleId}>
        <form action={removeBatchMember}>
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="userId" value={userId} />
          <DialogTitle id={titleId}>Remove {email} from this batch?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              They will no longer be able to open this batch. Their decisions stay on the record, and you can add them
              again later.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" color="error" variant="contained">
              Remove
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
