# ADR-0007: Test the database with PGlite and a Supabase stand-in

## Date and status
2026-11-04. Accepted.

## Context
The database rules are the most important part of the audit trail: nothing may be changed or deleted (ADR-0004), and users see only their own batches (US-14). These rules need automated tests. The tests must run on any developer machine and in CI, without a paid service and without a shared database that others could change.

## Options
- Option 1: Run tests against a real Supabase development project
  - Good: the closest match to production.
  - Bad: needs network access and credentials. Shared state can break tests. Costs a project slot.
- Option 2: Run a local Supabase stack with the Supabase CLI and Docker
  - Good: matches production closely.
  - Bad: needs Docker running. Heavy for a first project. Not installed on this machine.
- Option 3: PGlite (PostgreSQL compiled to run inside Node), with a small test-only stand-in for Supabase's `auth` schema
  - Good: no Docker, no network, no account needed. Runs in about a second. The stand-in uses the same `request.jwt.claim.sub` setting that Supabase uses, so row-level security is tested the way production applies it.
  - Bad: PGlite is not identical to Supabase's Postgres. The stand-in can drift from Supabase's real `auth` schema. Some Supabase-only features are not covered.

## Decision
Use Option 3. The tests load `tests/db/supabase-shim.sql`, then the real migration file, and each test signs in as a user by setting the claim and switching to the `authenticated` role. A mutation check confirmed the tests fail when a rule is removed.

## Consequences
- Every migration must run on both PGlite and Supabase. The migration never creates the `auth` schema itself.
- Before the first real review, run the same migration against a Supabase development project and repeat the key checks there (append-only and row-level security). This is not covered by the PGlite tests.
- The stand-in must be kept in step with Supabase's documented `auth` functions. Check it when the Supabase version changes.
- Next steps: add a CI step that runs `npm test` on every pull request.
