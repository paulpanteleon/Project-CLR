"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { draftCriteriaVersion, type DraftState } from "./actions";

const PICO_FIELDS: { name: string; label: string; help: string }[] = [
  { name: "review_name", label: "Review name", help: "The review these criteria apply to. Versions are numbered within it." },
  { name: "review_topic", label: "Review topic", help: "State the topic in your own words. Every exclusion reason traces back to it." },
  { name: "population", label: "Population", help: "Who the studies must be about." },
  { name: "intervention", label: "Intervention", help: "The AI or automation the studies must describe." },
  { name: "comparator", label: "Comparator", help: "What the intervention is compared with, or 'None' if not needed." },
  { name: "outcomes", label: "Outcomes", help: "The outcomes the studies must report." },
  { name: "design", label: "Study design", help: "The study designs that are in scope." },
  { name: "dates", label: "Dates", help: "The publication dates in scope." },
];

// Drafts a criteria version (S13). The server checks the input and the database checks the rules.
export function DraftForm() {
  const [state, formAction, pending] = useActionState<DraftState, FormData>(draftCriteriaVersion, { error: null });

  return (
    <form action={formAction}>
      <Stack spacing={2}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {PICO_FIELDS.map((field) => (
          <TextField
            key={field.name}
            name={field.name}
            label={field.label}
            helperText={field.help}
            required
            fullWidth
            multiline={field.name === "review_topic"}
            minRows={field.name === "review_topic" ? 2 : undefined}
          />
        ))}
        <TextField
          name="reasons"
          label="Reasons"
          helperText="One per line, as CODE: label. Include the reasons for inclusion too, for example R-TOPIC-OK: Describes AI applied to clinical literature review."
          required
          multiline
          minRows={4}
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </Stack>
    </form>
  );
}
