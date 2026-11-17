# ADR-0019: Find decisions across a person's batches, and show each record's full history

## Date and status
2026-11-17. Accepted. Covers US-09, US-10, UC2, and screens S10 and S11. Builds on ADR-0004 (append-only events), ADR-0014 (decisions bound to the batch criteria), ADR-0015 (AI proposals and their reproducibility set), ADR-0016 (batch membership) and ADR-0017 (the export's email lookup).

## Context
Release 1 must help a medical writer answer a reviewer's question about any decision within minutes (scope, outcome 4). Before this, a decision could be seen only on the screening page of its batch. That page showed the reviewer as "you" or "another reviewer", and had no search or filter.

The owner chose (2026-11-17):
- Search every batch the person is a member of, not one batch at a time. Someone asking about a PubMed ID may not know which batch it was in.
- Show reviewers by email. FR-DR-07 allows the reviewer's name and email in a decision record.

## Options
For where the search runs:
- Option 1: Filter in the app after reading every record with row-level security
  - Bad: reads every record in every batch on each search. Emails still need a database function.
- Option 2: One database function that searches and filters (chosen)
  - Good: one call, limited to the caller's batches in the same way as the export (ADR-0017). Returns at most 500 rows.

For showing who decided:
- Option 1: Read emails through `batch_member_details` (ADR-0016)
  - Bad: someone removed from a batch would lose their name on decisions they made.
- Option 2: A function that returns everyone in a batch's history (chosen)
  - Good: members, reviewers and whoever ran the AI first pass, including people who were later removed. Rows only go to members.

## Decision
- **`find_decisions`** returns one row per record in the caller's batches, with the current outcome, reason, reviewer email, time and number of corrections. Undecided records come back with empty decision fields. Filters, all optional:
  - search text: an exact PubMed ID, or part of the title or authors, in any case. `%` and `_` are treated as plain characters.
  - batch, outcome (including "undecided"), the reviewer who made the current decision, and the current reason code.
- Results put the newest decisions first, then undecided records. The page shows 100 and says when there are more.
- **`decision_reviewers`** lists the people who made a decision in the caller's batches, for the reviewer filter.
- **`batch_people`** returns the emails of everyone in a batch's history, to members only.
- All three are security definer functions with `search_path = ''`, available to signed-in users and not to anon. Membership uses the same rule as `permission_on_batch`: a membership row and a role.
- **The Decisions page** (`/decisions`, in the Batches menu) has the search and filters as a GET form, so each search has its own address. Each result opens the detail page.
- **The detail page** (`/batches/[id]/records/[pmid]`, S11) reads with row-level security, so a non-member gets a not-found page. It shows:
  - the current outcome, reason, supporting text, reviewer, time and criteria version, or "Not screened yet";
  - the history in order: every AI proposal, decision and correction. Each decision says whether it agreed with or overrode each AI proposal made before it. Each correction names the entry it corrects, which is kept unchanged;
  - each proposal's reproducibility set (model, prompt version, route, provider, ZDR, data region reported, generation ID, settings) and raw output, under a "Reproducibility details" toggle. The data region carries a note that US processing on the route is not yet confirmed (R-2), so the route name is not read as proof;
  - the record as screened, with the import file and date. Records never change after import (ADR-0004), so this is the text every reviewer and model saw;
  - the criteria version applied: its fields and reasons, with the current reason marked.
- The screening page links each record to its detail page.
- The outcome labels move to `src/lib/decisions.ts`, shared by the screening page, the export and the new pages.

## Consequences
- A reviewer's question can be answered from one search and one page, without knowing the batch.
- Searching and viewing are not audited. US-13 asks for every view of a shared review log to be logged, which is a separate feature.
- The search scans the caller's records with `ilike`. That is fast enough for the prototype's batches. P-5 (100,000 records) may need a trigram index later. The 2-second target (US-09) is not yet measured on production.
- Queries, query responses and disagreement flags (US-16, US-19) already appear in the history when they exist, with a generic label. Their own screens come later.
