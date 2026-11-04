# ADR-0002: Host on Vercel, with Supabase and OpenRouter

## Date and status
2026-10-28. Accepted. Replaces the earlier Google Cloud proposal.

## Context
The app needs three things from outside services: hosting for the app and its batch jobs, a database with sign-in, and access to Claude for screening. The project is a personal, non-commercial prototype with one developer, so managed services are preferred and the number of vendors should stay low. All data must stay in the United States (R-2).

## Options
- Option 1: Google Cloud (Cloud Run, Cloud SQL, Vertex AI)
  - Good: one large vendor. Strong US region controls.
  - Bad: many settings to manage. More setup for a new developer. Costs more to run at small scale.
- Option 2: Vercel (app and batch jobs), Supabase (database and sign-in), OpenRouter (Claude access)
  - Good: each service is managed and has a free or low-cost tier. Vercel deploys each change from Git. Supabase handles sign-in, multi-factor sign-in, and row-level security. OpenRouter lets the app pin requests to US endpoints and turn on zero data retention.
  - Bad: three vendors to track. Free tiers have limits (see ADR-0006). OpenRouter adds a content screening step from 27 October 2026 that may keep flagged content for human review.

## Decision
Use Option 2. Vercel hosts the Next.js app, its server code, and its batch workflows. Supabase provides the PostgreSQL database and sign-in. OpenRouter provides Claude, using only US-pinned endpoints with logging off, and zero data retention for confidential sources.

## Consequences
- Before any confidential document is loaded: confirm the OpenRouter data processing agreement in writing (S-6), confirm the content screening rule, and confirm ZDR is enforced on the account.
- Supabase encryption at rest still needs to be confirmed (S-3).
- Any new third party that receives data needs a new decision (see CLAUDE.md, "Ask before adding a paid service").
- Next steps: create the Supabase development and production projects (O-5). Set the OpenRouter monthly cap after the 20-record test batch (O-3).
