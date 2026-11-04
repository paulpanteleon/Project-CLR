# ADR-0009: Multi-factor sign-in with an authenticator app

## Date and status
2026-11-04. Accepted. Adds the multi-factor step that ADR-0008 left open. Needs a live test on the Supabase project before any real review.

## Context
S-1 requires multi-factor sign-in. A password alone is not enough to reach review data. The sign-in screen from ADR-0008 accepts a password only. Anyone who knows the password can now reach every screen, so the step must be added before real use.

## Options
- Option 1: Six-digit codes from an authenticator app (TOTP), using Supabase's built-in multi-factor support
  - Good: no SMS, so no phone number is stored or sent to a third party. The code is generated on the user's device. Supabase supports it with no extra service. Free to use.
  - Bad: a lost phone means the user cannot sign in until an admin removes the factor. Needs a QR code screen and a set-up step.
- Option 2: SMS codes
  - Good: works on any phone.
  - Bad: stores a phone number, which is personal data (S-7 lists only name and email). Sends data to a telephone provider. SMS is weaker than an app.
- Option 3: Email codes
  - Good: no phone needed.
  - Bad: the same email account also resets passwords, so it is not a second factor in practice.
- Option 4: Passkeys (device-bound sign-in)
  - Good: strongest option, and resists phishing.
  - Bad: more browser and device variation to support. Supabase support depends on the version in use. Better to add later than to start with.

## Decision
Use Option 1. Every user must set up an authenticator app before they reach any page. Every sign-in requires a code. Every attempt to enrol or check a code is written to the audit log (T-2). Unfinished set-ups are removed, so only one QR code is ever waiting.

Routing rules are in `src/lib/auth/mfa-routing.ts` and tested in `tests/auth/mfa-routing.test.ts`. Signed-out users go to sign-in. Signed-in users without a checked code go to set-up (no authenticator yet) or code entry (authenticator already set up). Checked users are kept off sign-in and the MFA pages.

## Consequences
- No recovery codes are issued. A user who loses their phone cannot sign in. Someone with owner access must remove the factor in the Supabase dashboard before the user can enrol again. Write this into the operations plan before the first real review.
- An admin screen to remove a factor is not built. It belongs with the admin screen for US-15.
- The Supabase project must have TOTP multi-factor turned on. Confirm this in the dashboard when the project is set up (see the open questions doc).
- The factor checks rely on Supabase's session assurance levels. A live test with a real authenticator app is still needed. The routing rules are tested, but the Supabase calls are not.
- Every page request now makes two calls to Supabase (user check and assurance level). Measure against P-2.
- Next steps: add sign-out to the batches page (currently only on the MFA pages), and add the admin factor-removal path (ADR-0008).
