# ADR-0016: Batch membership is managed by the batch's creator and owners, through database functions

## Date and status
2026-11-16. Accepted. Builds on ADR-0008 (sign-in and roles), ADR-0010 (database functions for writes) and ADR-0012 (the secret key's limited uses). Covers US-14, and lets US-04, US-05, US-11 and US-13 work for anyone other than the person who imported a batch.

## Context
A batch's creator becomes its only member when the batch is made (a trigger in the core schema). Row-level security shows a batch, its records and its decisions only to members. Nothing added anyone else, so a clinician reviewer or clinical affairs lead could never open a batch, and "send to clinician" had no one to send to.

To add someone, the app has to find them. Email addresses live in Supabase's `auth.users`, which signed-in users cannot read. The admin page reads them with the secret key, and ADR-0012 limits the secret key to two uses.

## Options
For who manages membership:
- Option 1: Only admins (owners) on the admin page
  - Bad: the writer who imports a batch would wait for an admin every time.
- Option 2: Any reviewer on the batch
  - Bad: anyone screening could share a confidential batch with anyone.
- Option 3: The batch's creator, and any member with the owner permission level (chosen)
  - Good: the writer who imports a batch can bring in the people they need. An owner can step in.
  - Bad: a creator can add anyone with a role, so trust sits with the creator.

For finding people:
- Option 1: A list of every user, read with the secret key
  - Bad: a third use of the secret key, and it shows every user to every creator.
- Option 2: Add by email address, looked up inside a database function (chosen)
  - Good: no secret key. Only the members of a batch see each other's email addresses.
  - Bad: the reply tells the caller whether an email has a role. Acceptable for a small prototype with known users.

## Decision
- `can_manage_batch(batch)`: true for a member who created the batch or has the owner permission level.
- `add_batch_member(batch, email)`: adds a user who has a role. Returns `ok`, `not_found`, `denied`, `unknown_user` (no account, or no role) or `already_member`.
- `remove_batch_member(batch, user)`: removes a member. The creator cannot be removed. Returns `ok`, `not_found`, `denied`, `not_member` or `creator`.
- `batch_member_details(batch)`: each member's email, user type, permission level, and whether they created the batch. It returns rows only to members of that batch.
- Every add and remove attempt is audited, allowed or not.
- Removing someone takes away their access, but their decisions and events stay as they were, because events are append-only (ADR-0004).

## Consequences
- The batch summary page lists the members. Anyone who can manage the batch also sees an add-by-email form and a Remove button for each member except the creator.
- What a member can do is still set by their permission level (ADR-0008): read-only members read, and reviewers and owners screen.
- Confidential batches follow the same rule, so the creator is responsible for who they add.
