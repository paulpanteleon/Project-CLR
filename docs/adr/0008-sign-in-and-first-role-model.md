# ADR-0008: Email and password sign-in, with owners as the first admins

## Date and status
2026-11-04. Accepted, with open items. The multi-factor step this ADR left open is added in ADR-0009 (2026-11-04). Sign-out is available on the MFA screens.

## Context
The app needs a way for users to sign in (S00, S-1). The requirements say sign-in uses email and multi-factor authentication. US-15 says an admin assigns user types and permission levels, but the docs do not say who the admin is. The first build needs a role model that can be tested now and changed later without a rewrite.

## Options
- Option 1: Email and password now, multi-factor later
  - Good: the simplest working sign-in, and it lets the rest of the build run.
  - Bad: falls short of S-1 until multi-factor is added. Must not be used for real review data before then.
- Option 2: Multi-factor from the start (Supabase authenticator app)
  - Good: meets S-1 from day one.
  - Bad: a larger screen flow (enrolment, recovery codes) before any feature works. Delays the rest of the build.
- Option 3: Email link (magic link) with no password
  - Good: no password to store or reset.
  - Bad: still needs multi-factor for S-1. Depends on email delivery during testing.

For the admin role, the options were a separate admin user type, or treating the permission level "owner" as admin.

## Decision
Use Option 1 now and add multi-factor before the first real review. Sign-in errors use one message for both a wrong email and a wrong password, so the form cannot reveal which accounts exist.

For the admin role, treat the "owner" permission level as the admin for now. Only an owner may change user types or permission levels, and the database enforces this (the first migration gives no client write access to `user_roles`, so changes go through a server-side admin path that is not built yet). A separate admin type can be added later without changing stored data.

## Consequences
- Done in ADR-0009: multi-factor sign-in with an authenticator app.
- Must do before the admin screen: confirm with the owner that "owner" is the right admin role. If not, add a new user type and update US-15.
- Sign-out is on the MFA screens only. The batches page has none yet.
- Sessions are refreshed in `src/proxy.ts`. The proxy calls the Supabase auth server on each page request, which adds a small delay. Measure it against P-2 (pages load within 2 seconds).
