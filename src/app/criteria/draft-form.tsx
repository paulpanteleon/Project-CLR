"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { draftCriteriaVersion, type DraftState } from "./actions";

// Each field starts with a simple example. The user can replace it.
const FIELDS: { name: string; label: string; help: string; example: string; multiline?: boolean }[] = [
  {
    name: "review_name",
    label: "Review name",
    help: "The review these criteria apply to. Versions are numbered within it.",
    example: "AI in clinical literature review",
  },
  {
    name: "review_topic",
    label: "Review topic",
    help: "State the topic in your own words. Every exclusion reason traces back to it.",
    example: "Clinical literature review that uses AI or automation.",
    multiline: true,
  },
  {
    name: "population",
    label: "Population",
    help: "Who the studies must be about.",
    example: "Published clinical studies of AI tools",
  },
  {
    name: "intervention",
    label: "Intervention",
    help: "The AI or automation the studies must describe.",
    example: "AI or automation used to screen or appraise literature",
  },
  {
    name: "comparator",
    label: "Comparator",
    help: "What the intervention is compared with, or 'None' if not needed.",
    example: "Manual screening by people",
  },
  {
    name: "outcomes",
    label: "Outcomes",
    help: "The outcomes the studies must report.",
    example: "Screening accuracy or time saved",
  },
  {
    name: "design",
    label: "Study design",
    help: "The study designs that are in scope.",
    example: "Primary studies and systematic reviews",
  },
  {
    name: "dates",
    label: "Dates",
    help: "The publication dates in scope.",
    example: "2018 to 2026",
  },
  {
    name: "reasons",
    label: "Reasons",
    help: "One per line, as CODE: label. Include the reasons for inclusion too.",
    example: "R-TOPIC-OK: Describes AI applied to clinical literature review.\nR-TOPIC-OUT: Does not describe AI applied to clinical literature review.",
    multiline: true,
  },
];

// Drafts a criteria version (S13). The server checks the input and the database checks the rules.
// Answers are kept in this form when a save fails, so the user only fixes the field named in the message.
export function DraftForm() {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((field) => [field.name, field.example])),
  );
  const [state, formAction, pending] = useActionState<DraftState, FormData>(draftCriteriaVersion, { error: null });

  const failedField = FIELDS.find((field) => field.name === state.field);

  return (
    <form action={formAction}>
      <Stack spacing={2}>
        {state.error && (
          <Alert severity="error">
            {failedField
              ? `Fix the ${failedField.label} field and save again. Your other answers are kept.`
              : state.error}
          </Alert>
        )}
        {FIELDS.map((field) => {
          const hasError = failedField?.name === field.name;
          return (
            <TextField
              key={field.name}
              name={field.name}
              label={field.label}
              value={values[field.name]}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              error={hasError}
              helperText={hasError ? state.error : field.help}
              required
              fullWidth
              multiline={field.multiline}
              minRows={field.multiline ? (field.name === "reasons" ? 4 : 2) : undefined}
            />
          );
        })}
        <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </Stack>
    </form>
  );
}
