# ADR-0017: Export screening decisions to CSV and Excel, with our own small Excel writer

## Date and status
2026-11-16. Accepted. Builds on ADR-0010 (database functions, and writing a small parser instead of adding a dependency), ADR-0014 (current outcome of a record) and ADR-0016 (batch membership). Covers the scope item "Export screening decisions to CSV and Excel" and the rule that every export is logged (functional requirements, 2026-10-23).

## Context
Screening decisions stayed inside the app. A medical writer needs the list of included and excluded studies, with reasons, to write the benefit-risk section and to answer reviewers. The decision record names the reviewer's email (FR-DR-07), which signed-in users cannot read from Supabase's `auth.users`.

## Options
For reading the data:
- Option 1: Read records, outcomes and reasons with separate queries in the app
  - Bad: the reviewer's email is not readable this way, and the export would not be logged.
- Option 2: One database function that returns the export rows and logs the export (chosen)
  - Good: one place that checks membership, reads the email, and writes the audit event.

For the Excel file:
- Option 1: Add an Excel library
  - Good: covers the whole format.
  - Bad: a large dependency for one plain table. The common choices are either heavy or published outside npm.
- Option 2: Write the few parts an `.xlsx` needs ourselves (chosen)
  - Good: no new dependency, as with the PubMed parser (ADR-0010). A plain table needs only six small XML parts in a zip with no compression.
  - Bad: it supports only text and number cells on one sheet. Anything more needs this decision revisited.

## Decision
- `batch_decision_export(batch)` returns one row per record in the batch, in PMID order: PMID, title, authors, journal, year, DOI, abstract, current outcome, reason code and label, supporting text, reviewer email, time, number of corrections, and criteria version. It returns rows only to members, and writes an audit event (`batch.export_decisions`) for every call, allowed or not.
- Records without a decision are listed as Undecided, so the export accounts for the whole batch.
- The third outcome is written as "Unsure", the agreed word (open questions, 2026-11-03).
- Times are written in UTC to the minute, as text, so a spreadsheet does not shift them.
- **CSV:** UTF-8 with a byte order mark, CRLF line ends, and quoting. A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe, so it cannot run as a formula.
- **Excel:** one sheet named Decisions, with a bold header row that stays in view. Text is stored as inline strings, so it never runs as a formula. Numbers (year, corrections) are stored as numbers. Text longer than Excel's cell limit (32,767 characters) is cut.
- Downloads come from `/batches/[id]/export?format=csv` or `?format=xlsx`, linked from the batch summary. Any member can download, including read-only members.

## Consequences
- The export shows the current outcome only. The full history of each record, and the AI proposals, are not in it yet. They belong with the review log export (PDF and Word), which is still to be built.
- Tests check the package structure, and check each part's checksum against Node's own CRC-32. A sample file also passed Python's zip and XML checks. A real export from the dev batch opened cleanly in Excel (checked by the owner, 2026-11-16).
