"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { CodeState } from "./actions";

type Props = {
  action: (previous: CodeState, formData: FormData) => Promise<CodeState>;
  factorId: string;
  submitLabel: string;
};

// Six-digit code entry, shared by the enrolment and sign-in checks.
export function CodeForm({ action, factorId, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      <Stack spacing={2}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        <input type="hidden" name="factorId" value={factorId} />
        <TextField
          name="code"
          label="6-digit code"
          slotProps={{
            htmlInput: { inputMode: "numeric", autoComplete: "one-time-code", maxLength: 8 },
          }}
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "Checking…" : submitLabel}
        </Button>
      </Stack>
    </form>
  );
}
