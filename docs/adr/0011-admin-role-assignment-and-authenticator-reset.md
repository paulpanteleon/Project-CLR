# ADR-0011: Admins assign roles and reset a lost authenticator

## Date and status
2026-11-05. Accepted. Settles two open items from ADR-0008 and ADR-0009. The admin screens and the reset action are not built yet.

## Context
Roles (user type and permission level) are assigned by an admin (US-15). ADR-0008 treated the "owner" permission level as the admin for now and left the admin path unbuilt. ADR-0009 says a user who loses their phone cannot sign in until someone removes the factor by hand in the Supabase dashboard. That is not a process to rely on once other people use the app.

## Options
For who is the admin:
- Option 1: The owner permission level is the admin (ADR-0008 as written)
  - Good: no new stored role. The permission model already has it.
  - Bad: owners are also the people who resolve disagreement flags and close queries (US-16, US-19). Admin rights and review rights are tied together.
- Option 2: A separate admin user type or flag
  - Good: admin rights can be given without review rights.
  - Bad: a new role to store, test, and explain. Not needed with a single developer and owner.

For a lost authenticator:
- Option 1: Recovery codes, shown once at set-up
  - Good: the user can recover without anyone else.
  - Bad: the codes are one more secret to store and lose. A lost code list still locks the user out.
- Option 2: An admin resets the authenticator. The user signs in with their password, then sets up a new one.
  - Good: no secret to store. The admin decides, and the change is audited.
  - Bad: needs an admin screen and a server-side step. The user waits for an admin.
- Option 3: The user removes their own authenticator after a password check
  - Good: no waiting.
  - Bad: anyone with the password could remove the second factor. This defeats the point of multi-factor sign-in (S-1).

## Decision
- **Admin.** Use Option 1: an admin is a user with the owner permission level. Only an admin assigns user types and permission levels (US-15). This confirms ADR-0008. If owners and admins need to be separate later, add a new user type and update US-15 (no stored data changes).
- **Authenticator reset.** Use Option 2. An admin marks a user for an authenticator reset. The change is written to the audit log with the admin and the time. At the user's next sign-in:
  1. The user must still enter their password. A reset does not skip it.
  2. The old authenticator is removed, so its codes stop working.
  3. The user goes to set-up and must register a new authenticator before they reach any page (ADR-0009 routing).
  4. The reset mark is cleared when the new authenticator is verified. The new factor is audited like any enrolment.
- The reset mechanism uses a server-side admin action. The publishable key cannot remove another user's factor, so this needs a server route with the secret key. That key is never sent to the browser and is never written to the repo (S-4). Choosing how to hold that key is part of building the feature. Ask before adding it.

## Consequences
- ADR-0009's "remove the factor in the Supabase dashboard" step stays as a fallback for the owner until the admin screen is built.
- No recovery codes. A user who loses their phone and has no admin reachable is still locked out.
- The admin screen (US-15) and the reset action (US-21) both need building. Both are recorded in the audit log.
- Owners cannot lock themselves out without another owner to reset them. Keep at least two owners before the first real review (open items, operations plan).
- Next steps: build the admin users screen with the role change and the reset mark; add the server-side reset action; test that a user with a reset mark cannot reach any page until a new authenticator is verified.
