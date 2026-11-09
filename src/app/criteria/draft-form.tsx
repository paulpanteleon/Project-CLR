"use client";

import { useActionState, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { draftCriteriaVersion, type DraftState, updateCriteriaDraft } from "./actions";

// Each field starts with a simple example, shown as "Ex: ...". The user replaces it.
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

const exampleText = (field: { example: string }) => `Ex: ${field.example}`;

// Drafts a criteria version (S13), or edits an existing draft when draftId is given.
// The server checks the input and the database checks the rules. Answers are kept when a save
// fails, so the user only fixes the field named in the message.
export function DraftForm({ draftId, initialValues }: { draftId?: string; initialValues?: Record<string, string> }) {
  const editing = draftId !== undefined;
  const [values, setValues] = useState<Record<string, string>>(
    () => initialValues ?? Object.fromEntries(FIELDS.map((field) => [field.name, exampleText(field)])),
  );
  const [state, formAction, pending] = useActionState<DraftState, FormData>(
    editing ? updateCriteriaDraft : draftCriteriaVersion,
    { error: null },
  );

  const failedField = FIELDS.find((field) => field.name === state.field);

  // A field still showing its example is sent empty, so the example is never saved as criteria.
  function submit(formData: FormData) {
    if (!editing) {
      for (const field of FIELDS) {
        if (values[field.name] === exampleText(field)) {
          formData.set(field.name, "");
        }
      }
    }
    formAction(formData);
  }

  return (
    <form action={submit}>
      <Stack spacing={2}>
        {editing && <input type="hidden" name="criteriaVersionId" value={draftId} />}
        {state.error && (
          <Alert severity="error">
            {failedField
              ? `Fix the ${failedField.label} field and save again. Your other answers are kept.`
              : state.error}
          </Alert>
        )}
        {FIELDS.map((field) => {
          const hasError = failedField?.name === field.name;
          const locked = editing && field.name === "review_name";
          const showingExample = !editing && values[field.name] === exampleText(field);
          return (
            <TextField
              key={field.name}
              name={field.name}
              label={field.label}
              value={values[field.name]}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              error={hasError}
              helperText={hasError ? state.error : field.help}
              required={!locked}
              disabled={locked}
              fullWidth
              multiline={field.multiline}
              minRows={field.multiline ? (field.name === "reasons" ? 4 : 2) : undefined}
              sx={showingExample ? { "& .MuiInputBase-input": { color: "text.secondary" } } : undefined}
            />
          );
        })}
        <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>
          {pending ? "Saving…" : editing ? "Save changes" : "Save draft"}
        </Button>
      </Stack>
    </form>
  );
}
