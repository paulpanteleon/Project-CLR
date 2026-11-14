"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { runFirstPass } from "./first-pass-actions";

const MODEL_OPTIONS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
];

// Starts the AI first pass for the batch with one model. The proposals are not decisions (ADR-0015).
export function FirstPassForm({ batchId }: { batchId: string }) {
  const [model, setModel] = useState(MODEL_OPTIONS[0].id);

  return (
    <form action={runFirstPass}>
      <input type="hidden" name="batchId" value={batchId} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <TextField
          name="model"
          label="AI model"
          select
          size="small"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          helperText="Proposals are stored with their model. They are not decisions."
          sx={{ minWidth: 240 }}
        >
          {MODEL_OPTIONS.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="outlined">
          Run AI first pass
        </Button>
      </Stack>
    </form>
  );
}
