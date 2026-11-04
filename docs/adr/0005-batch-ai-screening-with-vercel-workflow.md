# ADR-0005: Run AI screening of a batch as a Vercel Workflow

## Date and status
2026-10-23. Accepted (confirmed for P-1, with the test pending).

## Context
A batch of up to 500 records must get an AI first pass within 60 minutes (P-1, US-03). Each AI call takes several seconds, so the whole batch takes far longer than one web request is allowed to run. A failed record must be retried, and a batch must be able to pause and resume without losing records (US-03).

## Options
- Option 1: Run the batch inside one web request
  - Good: simplest code.
  - Bad: Vercel stops any function that runs longer than its time limit (300 seconds per function in P-1). A batch of 500 would be cut off.
- Option 2: A background queue service (for example, a separate worker server)
  - Good: no time limit on the work.
  - Bad: another service to host and pay for. Against the "fewest vendors" rule (see ADR-0002).
- Option 3: Vercel Workflow, which splits the batch into steps that each run within the time limit and saves progress between steps
  - Good: stays on Vercel. Each record is saved as it finishes, so a pause or failure loses nothing. Steps can be retried.
  - Bad: Hobby plan limits on workflow events and data apply (NFR open item 6). Going over them pauses features for up to 30 days.

## Decision
Use Option 3. Each record's AI call is one workflow step. Every proposal is saved with its full reproducibility set (T-3) before a reviewer sees it. The batch pauses if the US route is unavailable or a usage limit is reached (US-03).

## Consequences
- Checks on the Hobby plan limits must be done before the first real batch.
- Confidential batches are sent only through zero-retention routes (FR-DR-12). A batch that cannot use one does not start.
- The AI model and its settings are chosen from a test of two or three models on the same sample (NFR open item 2). This decision is recorded in a new ADR.
- Next steps: build a 20-record test batch to measure time and cost (P-1, O-3).
