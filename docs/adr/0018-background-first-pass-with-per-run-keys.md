# ADR-0018: Run the AI first pass in the background with Vercel Workflows and a per-run key

## Date and status
2026-11-16. Accepted. Carries out ADR-0005 (batch AI screening as a Vercel Workflow), and builds on ADR-0012 (the secret key's limited uses), ADR-0015 (first-pass proposals on a pinned route) and ADR-0016 (batch membership). Covers US-03 and P-1 (500 records within 60 minutes).

## Context
The first pass ran inside one web request, one record at a time, about 9 seconds per record. A batch of 20 needed two clicks to stay inside the time budget. A batch of 500 would take about 75 minutes and many clicks, which misses P-1.

Background steps run without the user's browser session, so they cannot call the database as the user. The owner chose a per-run key over the Supabase secret key, and approved the `workflow` package and Vercel Workflows on the Hobby plan (2026-11-16).

Vercel Workflows on Hobby (checked 2026-11-16):
- 50,000 workflow events a month are included. A step that succeeds first time writes 3 events. Going over pauses Workflows for up to 30 days rather than billing.
- Vercel stores each run's step inputs and outputs, and keeps run data for 1 day on Hobby. Team owners can read it.
- A run is pinned to the region of the function that starts it.

## Options
For how steps reach the database:
- Option 1: The Supabase secret key
  - Bad: full access, and a third use of the secret key, which ADR-0012 limits to two.
- Option 2: A per-run key (chosen)
  - Good: the key works for one run only, only while it is running, and for at most 2 hours. It can only read that batch's criteria and records, and store proposals for it. The database keeps only its SHA-256 hash and clears the hash when the run ends.
  - Bad: the key is a step input, so Vercel stores it with the run for 1 day. It stops working when the run ends, so a stored copy is of no use after that.

For what passes between steps:
- Option 1: Send record text and model replies between steps
  - Bad: Vercel would store titles, abstracts and model output with the run.
- Option 2: Pass only ids, the run key and short status words (chosen)
  - Good: record text and model output go only between our database and the model, inside a step.

## Decision
- **Starting a run.** A reviewer or owner clicks Run AI first pass. The server action makes a random 32-byte key and calls `start_ai_run` with its hash. The function applies the same rules as before (open, public, criteria version set) and allows one running run per batch, model and prompt version. It records the run in `ai_runs` with the number of records still to do, and audits the attempt. The action then starts the workflow with the run id, the key and the model.
- **The workflow** (`src/workflows/ai-first-pass.ts`) lists the pending records, then works through them ten at a time with `Promise.allSettled`. Each record is one step. The step reads the criteria and the record, asks the model on the pinned route (ADR-0015), and stores the proposal. A step is retried twice on passing errors, and after 1 minute on a rate limit (429). A record that still fails is counted as failed, with its last error.
- **Stopping early.** The run stops, and is marked as stopped with the reason, when:
  - the key no longer works;
  - the person who started it is no longer a reviewer or owner on the batch;
  - the batch is closed, confidential or has no criteria version;
  - OpenRouter refuses the key or credit;
  - a reply comes from a route other than the pinned one.
- **Proposals** are recorded as made by the person who started the run. The checks are made again for every record. The pinned route, zero retention, and reasons from the criteria stay enforced by the `ai_proposals` table (ADR-0015).
- **Progress.** Members see each run's status and counts on the screening page, which refreshes every 5 seconds while a run is going. Nobody can read the key hash.
- **Expiry.** A run left running past 2 hours is closed as expired when the next run starts on that batch.
- **Code that steps import** must not carry the `server-only` marker, which throws outside React's server environment. The OpenRouter client moved to `src/lib/ai/model-call.ts`. App code keeps importing it through `src/lib/ai/openrouter.ts`, which keeps the marker.
- **Setup:** `withWorkflow` wraps `next.config.ts`. `proxy.ts` skips `/.well-known/workflow/`. The SDK's generated route files are kept out of git and lint.

## Consequences
- The in-request loop is gone. Each click starts a background run, and the person can leave the page.
- Ten records at a time should finish a 500-record batch well within 60 minutes, at about 9 seconds per record. This is not yet measured on a real 500-record batch.
- One model on 500 records uses about 1,500 workflow events, so the Hobby allowance covers about 30 such runs a month.
- `store_ai_proposal` (ADR-0015) is no longer called by the app. It is kept, because it still enforces the same rules if anyone calls it.
- Confidential batches are still refused (ADR-0015).
