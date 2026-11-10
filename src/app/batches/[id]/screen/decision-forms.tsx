"use client";

import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { correctDecision, recordDecision } from "../../actions";

export type ReasonOption = { code: string; label: string };

// The four outcomes a reviewer can record. "Maybe" is stored as "unsure".
const OUTCOME_BUTTONS: { value: string; label: string; color: "success" | "error" | "warning" | "info" }[] = [
  { value: "include", label: "Include", color: "success" },
  { value: "exclude", label: "Exclude", color: "error" },
  { value: "unsure", label: "Maybe", color: "warning" },
  { value: "send_to_clinician", label: "Send to clinician", color: "info" },
];

// Records a first decision on a record. The reason comes from the batch's criteria version.
export function DecisionForm({
  batchId,
  pmid,
  reasons,
}: {
  batchId: string;
  pmid: string;
  reasons: ReasonOption[];
}) {
  return (
    <form action={recordDecision}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="pmid" value={pmid} />
      <Stack spacing={2}>
        <ReasonField reasons={reasons} />
        <TextField name="freeText" label="Note (optional)" size="small" fullWidth />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {OUTCOME_BUTTONS.map((button) => (
            <Button key={button.value} type="submit" name="outcome" value={button.value} variant="contained" color={button.color}>
              {button.label}
            </Button>
          ))}
        </Stack>
      </Stack>
    </form>
  );
}

// Changes a decision by adding a new event. The reason is required (US-11).
export function CorrectionForm({
  batchId,
  eventId,
  reasons,
}: {
  batchId: string;
  eventId: string;
  reasons: ReasonOption[];
}) {
  return (
    <form action={correctDecision}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="eventId" value={eventId} />
      <Stack spacing={2}>
        <ReasonField reasons={reasons} />
        <TextField name="freeText" label="Why is this changing?" size="small" fullWidth required />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {OUTCOME_BUTTONS.map((button) => (
            <Button key={button.value} type="submit" name="outcome" value={button.value} variant="outlined" color={button.color}>
              {button.label}
            </Button>
          ))}
        </Stack>
      </Stack>
    </form>
  );
}

function ReasonField({ reasons }: { reasons: ReasonOption[] }) {
  return (
    <TextField name="reason" label="Reason" select size="small" fullWidth required defaultValue="">
      <MenuItem value="" disabled>
        Choose a reason from the criteria
      </MenuItem>
      {reasons.map((reason) => (
        <MenuItem key={reason.code} value={reason.code}>
          {reason.code}: {reason.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
