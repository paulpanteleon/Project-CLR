# ADR-0004: Store decisions and AI proposals as append-only events

## Date and status
2026-10-23. Accepted. Database enforcement added 2026-11-04.

## Context
Every screening decision and every AI proposal must be kept so that a reviewer can see the full history later (FR-DR-04, T-2, US-10, US-11). Nothing may be changed or deleted. A correction is a new record that points to the one it corrects.

## Options
- Option 1: One row per decision, updated when it changes
  - Good: simple to read the current answer.
  - Bad: the old answer is lost unless extra history tables are added. Easy to change by mistake.
- Option 2: Append-only event tables, with the current answer found by reading the latest event
  - Good: the full history is kept by design. Matches how auditors expect records to behave.
  - Bad: "current answer" needs a query that reads the latest event. Slightly more work for the developer.
- Option 3: Append-only events, with a separate table that holds the current answer for fast reads
  - Good: fast reads, and the history is still kept.
  - Bad: two places to keep in sync. Adds a step to every save.

## Decision
Use Option 2. Human decisions, AI proposals, overrides, queries, and corrections are rows in event tables. The database refuses updates and deletes on those tables, using permission settings and a trigger. The current outcome for a record is the latest correction. If reads become slow, Option 3 can be added later as a view, without changing the events.

## Consequences
- Every save creates a new row. Storage grows, but the sizes are small for 100,000 records (P-5).
- The current outcome is found with one query over the latest event per record. This needs a test.
- Every event stores the time in UTC (FR-DR-08).
- Next steps: write the trigger and permission rules in the first migration. Add a test that tries an update and a delete and expects both to fail.
