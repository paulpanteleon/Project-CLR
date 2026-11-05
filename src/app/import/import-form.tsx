"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { importPubmedFile, type ImportState } from "./actions";

const initialState: ImportState = { error: null };

// Import form (S02, US-01). Import stays disabled until a source label is chosen.
export function ImportForm() {
  const [state, formAction, pending] = useActionState(importPubmedFile, initialState);
  const [label, setLabel] = useState<"public" | "confidential" | "">("");

  return (
    <form action={formAction}>
      <Stack spacing={3}>
        {state.error && <Alert severity="error">{state.error}</Alert>}

        <div>
          <Typography variant="subtitle1" gutterBottom>
            PubMed export file
          </Typography>
          <input type="file" name="file" accept=".txt,.nbib,text/plain" required />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Up to 500 records per batch. Split larger exports before importing.
          </Typography>
        </div>

        <FormControl>
          <FormLabel id="source-label">Data source label (required before import)</FormLabel>
          <RadioGroup
            aria-labelledby="source-label"
            name="source_label"
            value={label}
            onChange={(event) => setLabel(event.target.value as "public" | "confidential")}
          >
            <FormControlLabel value="public" control={<Radio />} label="Public" />
            <FormControlLabel value="confidential" control={<Radio />} label="Confidential" />
          </RadioGroup>
          {label === "confidential" && (
            <Typography variant="body2" color="text.secondary">
              Confidential sources are sent only through a route with zero data retention enforced.
            </Typography>
          )}
          {label === "" && (
            <Typography variant="body2" color="text.secondary">
              Choose a source label to enable Import.
            </Typography>
          )}
        </FormControl>

        <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end" }}>
          <Button component={Link} href="/" color="inherit">
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={label === "" || pending}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
