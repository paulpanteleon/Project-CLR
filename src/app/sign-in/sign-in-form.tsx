"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction}>
      <Stack spacing={2}>
        {state.error && <Alert severity="error">{state.error}</Alert>}
        <TextField
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          fullWidth
        />
        <TextField
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </Stack>
    </form>
  );
}
