# ADR-0012: Admin page, role changes through database functions, and the secret key

## Date and status
2026-11-05. Accepted. Builds ADR-0011 (admin role assignment and authenticator reset).

## Context
ADR-0011 says owners assign roles and reset authenticators. Three things need a design: how a role change is written (the app cannot write `user_roles` directly), how the admin page lists people by email (that list is only available to the secret key), and how a reset is carried out (removing another user's authenticator also needs the secret key).

## Options
For writing roles:
- Option 1: Direct table writes from the server, with the secret key
  - Good: simple code.
  - Bad: the secret key bypasses row-level security, so the owner check lives only in app code. A bug there changes roles for anyone.
- Option 2: Database functions that check the caller is an owner, then write, then audit (chosen)
  - Good: the rule is enforced in the database, the same as the other rules. Denied attempts are recorded.
  - Bad: the rules live in SQL as well as the app (ADR-0010 accepted the same trade-off).

For the admin list and the reset:
- Option 1: Read emails with the secret key on every page load, and remove factors from the page directly
  - Bad: the secret key runs in more code than it needs to.
- Option 2: Use the secret key only in two places: listing users on the admin page, and removing a factor at sign-in (chosen)
  - Good: the key is read only in server code that first checks the caller is an owner (for the page) or that the user has a pending reset (for sign-in).

For the reset timing:
- Option 1: Remove the authenticator when the admin clicks the button
  - Bad: the user is locked out immediately, even if the admin clicks by mistake, and the user has no say in when.
- Option 2: Mark the user, and remove the old authenticator at their next sign-in, after the password check (chosen, as ADR-0011)

## Decision
- **Role changes** go through `admin_set_role`, a database function. It returns `ok`, `denied` (caller is not an owner), or `last_owner` (the change would leave no owner). Every attempt is written to `audit_events`. Denied attempts return a result instead of raising an error, so the record is kept.
- **Reset request** goes through `admin_request_reset`, which sets `reset_requested_at` and `reset_requested_by` on the user's `user_roles` row and writes an audit event.
- **Reset completion** goes through `complete_authenticator_reset`, which clears the flag on the caller's own row only. It is called after a new authenticator is verified. Clearing the flag gives no access on its own. A user still needs a verified factor, and the reset only ever makes sign-in stricter.
- **Owner check** is `is_owner()`, a security definer function. Owners can read all `user_roles` rows through a policy that uses it. Other users read only their own row.
- **Secret key.** `SUPABASE_SECRET_KEY` is read only by `src/lib/supabase/admin.ts`, which imports `server-only`. It is used in two places: the admin page lists users with their emails, and the sign-in verify page removes a user's old authenticator when a reset is pending. Both places check their precondition first. The key is never sent to the browser (ADR-0011, S-4).

## Consequences
- The database enforces who can change roles, so the rule holds even if the app is bypassed. The secret key can still bypass it, which is why it is limited to the two uses above.
- Reset takes effect at the user's next sign-in, not immediately. An admin cannot lock someone out in the middle of a session.
- If the flag is cleared without a new authenticator, nothing is granted, because the old authenticator was already removed. The user then has to set one up.
- Not covered yet: email notice to a user when their authenticator is reset; a limit on how many resets an admin can make; reset history screen. Add these when the owners ask for them.
- Testing: the database functions are tested against PGlite. The secret-key calls and the sign-in flow are not, and need a live test on the dev project before any real review.
