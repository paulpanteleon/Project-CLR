# Project CLR (prototype)

An AI literature assessment tool for medical writers doing device benefit-risk reviews. Personal, non-commercial prototype. Start with `CLAUDE.md`, then `docs/`.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the Supabase dashboard (Project Settings, API). Never commit `.env.local`.
3. Apply the database migration in `supabase/migrations/` to your Supabase project. Paste the file into the Supabase SQL editor and run it, or use the Supabase CLI.
4. Start the app: `npm run dev`, then open http://localhost:3000

## Checks

- `npm test`: database tests. They run the migration against an in-memory PostgreSQL (PGlite) and check the append-only rules and row-level security.
- `npm run lint`
- `npm run build`

## Layout

- `src/app/`: screens (S00 sign-in, S01 batches so far)
- `src/proxy.ts`: refreshes the session and sends signed-out visitors to sign-in
- `src/lib/supabase/`: server-side Supabase client and settings
- `supabase/migrations/`: database schema, append-only rules, row-level security
- `tests/db/`: database tests
- `docs/`: vision, scope, requirements, architecture plan, ADRs (`docs/adr/`)

Read every ADR in `docs/adr/` before changing the app.
