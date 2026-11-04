// Decides where a request should go, based on who is signed in and how far through
// multi-factor sign-in they are (S-1, ADR-0009).
//
// Assurance levels, as Supabase reports them:
//   aal1: signed in with a password only
//   aal2: signed in and checked with an authenticator code
// nextLevel is aal2 when the user already has a verified authenticator, and aal1
// when they do not. A user at aal1 must reach aal2 before any other page.
//
// Kept free of framework code so the rules can be tested directly.

export type AssuranceLevel = "aal1" | "aal2";

export type SessionState = {
  signedIn: boolean;
  currentLevel: AssuranceLevel | null;
  nextLevel: AssuranceLevel | null;
};

export const SIGN_IN = "/sign-in";
export const ENROLL = "/mfa/enroll";
export const VERIFY = "/mfa/verify";
export const HOME = "/";

// Returns the path to redirect to, or null if the request may continue.
export function routeFor(pathname: string, state: SessionState): string | null {
  const onSignIn = pathname.startsWith(SIGN_IN);
  const onMfa = pathname.startsWith("/mfa");

  if (!state.signedIn) {
    return onSignIn ? null : SIGN_IN;
  }

  if (state.currentLevel === "aal2") {
    return onSignIn || onMfa ? HOME : null;
  }

  // Signed in with a password only. The next step is the authenticator.
  const target = state.nextLevel === "aal2" ? VERIFY : ENROLL;
  return pathname === target ? null : target;
}
