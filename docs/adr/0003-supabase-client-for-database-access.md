# ADR-0003: Use the Supabase client for database access

## Date and status
2026-11-04. Accepted.

## Context
The app's server code needs to read and write the database. The database must enforce who can see which batch (S-2, US-14), and it must refuse any change to an existing decision (T-2, FR-DR-04). The developer is new to databases.

## Options
- Option 1: Supabase's own JavaScript client (`@supabase/supabase-js`), with the table and security rules written as SQL in Supabase
  - Good: the simplest option for a first project. Row-level security rules sit in the database, so they apply no matter which code calls it. Supabase's sign-in works with the same client.
  - Bad: queries are written against the client's own methods, and complex joins are harder to read than plain SQL.
- Option 2: Drizzle ORM (a code library that describes tables in TypeScript) in front of Supabase's Postgres
  - Good: table definitions and queries are type-checked in the code. Migrations are generated from the code.
  - Bad: one more library to learn and keep up to date. The security rules still have to be written in SQL, so there are two places to keep in sync.
- Option 3: Prisma
  - Good: well documented.
  - Bad: heavier to set up with Supabase's row-level security.

## Decision
Use Option 1, the Supabase client, with schema changes written as SQL migration files in the repository. Row-level security is turned on for every table, and the database itself blocks updates and deletes on the audit and decision tables (see ADR-0004).

## Consequences
- The security rules live in SQL. Each rule needs a test that shows a user without access is refused.
- Queries are written with the client's methods. If a query becomes hard to read, a SQL function in the database can be added.
- Migration files go in `supabase/migrations/` and are reviewed in the same PR as the code that uses them.
- Next steps: write the first migration from the table list in `docs/architecture/plan.md` (tier 3). Review it against the data checks in the NFR doc (T-4).
