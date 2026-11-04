"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { confirmEnrollment, startEnrollment, type EnrollState } from "../actions";
import { CodeForm } from "../code-form";

const initialState: EnrollState = { error: null };

// Multi-factor set-up (S-1). Step 1: the user asks for a QR code. Step 2: they scan it
// and enter the first code to confirm.
export function EnrollFlow() {
  const [state, formAction, pending] = useActionState(startEnrollment, initialState);

  if (state.factorId && state.qrCode && state.secret) {
    return (
      <>
        <Typography variant="h5" component="h1" gutterBottom>
          Set up your authenticator
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Scan this code with an authenticator app (for example, Google Authenticator or
          Microsoft Authenticator). Then enter the 6-digit code it shows.
        </Typography>
        <Box
          component="img"
          src={state.qrCode}
          alt="QR code to add this account to your authenticator app"
          sx={{ display: "block", mx: "auto", width: 200, height: 200, mb: 2 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, wordBreak: "break-all" }}>
          Cannot scan? Enter this key instead: <code>{state.secret}</code>
        </Typography>
        <CodeForm action={confirmEnrollment} factorId={state.factorId} submitLabel="Confirm" />
      </>
    );
  }

  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        Set up your authenticator
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        You need an authenticator app to sign in to Project CLR. Press the button to get a QR
        code to scan.
      </Typography>
      {state.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {state.error}
        </Alert>
      )}
      <form action={formAction}>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "Preparing…" : "Start set-up"}
        </Button>
      </form>
    </>
  );
}
