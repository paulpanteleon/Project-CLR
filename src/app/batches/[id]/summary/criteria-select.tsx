"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { setBatchCriteria } from "../../actions";

export type CriteriaOption = { id: string; label: string };

// Chooses the criteria version for a batch (S04, US-02). Once a decision exists, the form is shown
// but the database refuses the change.
export function CriteriaSelect({
  batchId,
  options,
  currentId,
  locked,
}: {
  batchId: string;
  options: CriteriaOption[];
  currentId: string | null;
  locked: boolean;
}) {
  const [choice, setChoice] = useState(currentId ?? "");

  return (
    <form action={setBatchCriteria}>
      <input type="hidden" name="batchId" value={batchId} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <TextField
          name="criteriaVersionId"
          label="Criteria version"
          select
          size="small"
          fullWidth
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={locked}
          helperText={locked ? "Decisions already exist, so the version is fixed." : "Only approved versions can be chosen."}
        >
          {options.length === 0 && <MenuItem value="" disabled>No approved criteria yet</MenuItem>}
          {options.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" disabled={locked || choice === "" || choice === currentId} sx={{ minWidth: 140 }}>
          Save version
        </Button>
      </Stack>
    </form>
  );
}
