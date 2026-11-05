# ADR-0010: Import a PubMed file in one database step, with our own parser

## Date and status
2026-11-04. Accepted.

## Context
Importing a PubMed export (US-01, UC1) creates three things: a batch, the uploaded file, and its records. If the app saved them as separate calls, a failure part way through would leave a file with no records, or a batch with no file. Files and records are append-only (ADR-0004), so a partial import could not be cleaned up. The import also needs to read a text format (MEDLINE) that is not JSON or CSV.

## Options
- Option 1: Three separate calls from the app (create batch, save file, save records)
  - Good: simplest code.
  - Bad: a failure in the middle leaves unremovable rows behind.
- Option 2: One database function that creates all three in a single transaction, called once from the app
  - Good: all or nothing. A failed check rolls everything back. Row-level security still applies, because the function runs with the caller's rights.
  - Bad: the rules live in SQL as well as in the app. Changes need a migration.
- Option 3: A third-party MEDLINE parser library
  - Good: less code to write.
  - Bad: a new dependency. Parsers for this format are small and little used. CLAUDE.md asks for approval before adding a dependency that sends data to a new third party. A parser does not send data, but the format is simple enough to write and test here.

For the parser, the choice was between Option 3 and writing one. Writing one keeps the dependency count down, and the format needs only a few fields.

## Decision
Use Option 2 for saving, and write a small parser in `src/lib/pubmed/` (Option 3 declined). The database function is `import_pubmed_batch`, in migration `20261104020000_import_pubmed_batch.sql`.

Rules applied before saving, in the app:
- More than 500 records: refused, and the user is told to split the file (US-01).
- A record with no PubMed ID or no title: rejected. It is left out and counted.
- A record with no abstract: flagged. It is kept and screened from its title (UC1).
- A PubMed ID that appears twice in the same file: the first copy is kept and later copies are counted as duplicates and left out. This is a default. UC1 says the reviewer should choose which copy to keep. That choice needs a screen, so it is deferred.

A PubMed ID may appear in more than one batch. Each batch keeps its own copy (decided 2026-11-04). The Figma import summary shows duplicates resolved by choosing a copy in an earlier batch. That does not match the one-copy-per-batch decision, so the Figma screen needs updating before it is built.

## Consequences
- The database enforces the 500-record limit and the one-copy-per-batch rule, so they hold even if the app is bypassed.
- The import summary counts (rejected and duplicates) are stored on the source file row, because the file is append-only and the counts must match what was imported.
- Next steps: update the Figma import summary to match the decision above. Decide whether a reviewer should choose which duplicate to keep, and if so, add that screen.
