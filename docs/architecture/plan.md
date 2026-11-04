# Architecture plan: Project CLR prototype

Status: draft for review, 2026-11-04. No app code until this plan is approved.
Decisions behind this plan: `docs/adr/` (ADR-0001 to ADR-0006).
Sources: `docs/scope.md`, `docs/functional-requirements.md`, `docs/non-functional-requirements.md`, and the Figma prototype file ("Project CLR Prototypes", Screens page and Flows page).

## Plain-language guide

A web app like this has three layers. Think of a restaurant:

- **Tier 1, the screens (the dining room).** What the medical writer sees and clicks in the browser.
- **Tier 2, the server code (the kitchen).** The code that checks who you are, applies the rules, calls the AI, and saves the result. It runs on Vercel, not in the browser, so secret keys stay hidden.
- **Tier 3, the database (the pantry).** Where everything is stored, on Supabase. It also enforces rules, such as "you can only see your own batches," so a mistake in the screens or the kitchen can't leak data.

Other terms used here:
- **Next.js:** the framework that holds the screens and the server code in one project (ADR-0001).
- **Material UI:** a set of ready-made building blocks (buttons, tables, forms) that look consistent (ADR-0001).
- **Supabase:** the database and sign-in service (ADR-0002).
- **OpenRouter:** the service that gives the app access to Claude, the AI model (ADR-0002).
- **Row-level security:** a database rule that filters every query so a user only sees rows they are allowed to see.
- **Append-only:** rows can be added but never changed or deleted. A correction is a new row that points to the old one (ADR-0004).
- **Vercel Workflow:** a way to run a long job, such as screening 500 records, as many small steps that each finish in time (ADR-0005).

## Tier 1: Screens

Screen IDs match the Figma Screens page. All screens are wireframes with example data from the six-record test batch.

| ID | Screen | Used by | Stories |
|---|---|---|---|
| S00 | Sign in | everyone | S-1 |
| S01 | Batches (list of batches, with source label, criteria version, record count, status) | MW, CR, CAL | US-14 |
| S02 | Import batch (PubMed export file, source label public or confidential) | MW | US-01 |
| S03 | Import summary (counts, duplicates, missing abstracts) | MW | US-01 |
| S04 | Batch setup (criteria version, two-reviewer setting) | MW | US-02, US-19 |
| S05 | AI first pass running | MW | US-03 |
| S05b | AI first pass paused (route or usage limit) | MW | US-03 |
| S06 | Screening queue (sprint progress, AI proposal, keyboard shortcuts) | MW, CR | US-03, US-17, US-18 |
| S07 | Record decision (confirm an AI proposal, one step) | MW | US-04 |
| S08 | Override with reason (reason from the criteria list) | MW | US-05 |
| S09 | Close batch (blocked while records are undecided) | MW | US-08 |
| S10 | Find a decision (by PubMed ID, title, or author) | CAL, MW, CR | US-09 |
| S11 | Decision history (proposal, decision, override, corrections, queries) | CAL, CR, MW | US-10, US-16 |
| S12 | Clinician queue (records sent to review, with full history) | CR | US-07 |
| S13 | Criteria versions (draft, approve, lock) | MW, CAL | US-02, US-12 |
| S14 | Share review log (named user, or an expiring link) | CAL | US-13 |
| S15 | Access refused | everyone | US-14 |
| P1 | Applicability (placeholder, labels only, not built) | — | no story yet |
| P2 | Reproducibility and agreement (placeholder) | — | no story yet |

Stories with no screen in Figma yet, which need one before they are built:
- **Admin: assign user types and permission levels** (US-15). Needs an admin users screen.
- **Raise a query** (US-16). Needs a query form on S11.
- **Flag a disagreement and resolve it** (US-19). Needs a flag indicator on S06, and a resolve action for owners.
- **Calibration against a labelled set** (US-20). Needs its own screen. Deferred until the labelled set exists (open questions).
- **Keyboard shortcut help list** (US-18). Needs an overlay on S06.

Planned as placeholders, not built in Release 1 (the Figma file marks these):
- **Ranking control on S06** (no story yet). The relevance score is shown for ranking only (FR-DR-10).
- **P1 applicability** and **P2 reproducibility** (no story yet). The Figma placeholders use labels (applies, partly, does not apply, unclear), not confidence numbers, which matches FR-DR-10. The "justification sentence for the benefit-risk section" on P1 is out of scope for Release 1, so it should not be built yet.

Screen rules:
- Every screen must meet WCAG 2.1 AA (R-3). Screen sizes are not set in the requirements yet. Confirm before building the layouts.
- Pages load within 2 seconds, and saves complete within 1 second at the 95th percentile (P-2).
- Timestamps are shown in the reviewer's local time, with UTC stored (FR-DR-08).
- Material UI's theme is the one place colours and spacing are set.

## Tier 2: Server code

Everything here runs on Vercel, in Next.js server code. Browser code never sees the secret keys (S-4).

**Entry points**
- **Server Actions** for changes made from a screen (save a decision, close a batch).
- **Route Handlers** for file downloads and exports (CSV, Excel, PDF, Word).

**Modules**
1. **Auth and roles.** Checks the signed-in user and their user type and permission level before every action. Refused attempts are written to the audit log (US-14, US-15).
2. **PubMed import.** Reads a PubMed export file (MEDLINE format). Pulls out PMID, DOI, title, authors, year, journal, and abstract. Flags duplicate PMIDs and missing abstracts. Keeps the raw file as a snapshot in the database (US-01).
3. **Criteria.** Drafts, approves, and locks criteria versions. The drafter cannot approve their own draft. Approval is an audit event (US-12, FR-DR-06).
4. **AI screening (batch workflow).** Runs as a Vercel Workflow, with one step per record (ADR-0005). Each step:
   - sends the record and the locked criteria version to OpenRouter, pinned to a US endpoint with logging off, and with zero retention for confidential sources (ADR-0002);
   - saves the proposal and its full reproducibility set (criteria version, prompt version, model ID, settings, raw output, provider and endpoint, ZDR status) before a reviewer sees it (T-3);
   - retries failed records, and lists any that still fail;
   - pauses the batch if the US route or a usage limit is unavailable, without losing records (US-03).
5. **Spend tracking.** Records the cost of each AI call. Sends an alert at 80% of the monthly cap. OpenRouter's own spending limit is a second check (O-3).
6. **Decisions.** Saves human decisions, overrides, corrections, queries, and disagreement flags as new events. Never updates or deletes (ADR-0004). Refuses a save that lacks record, criteria version, reviewer, or timestamp (FR-DR-01). Every reason comes from the criteria list (FR-DR-02).
7. **Ranking.** Computes the relevance score from criteria match and study design, and stores it with its version (US-20, FR-DR-13). Used for sorting only.
8. **Exports.** CSV and Excel for screening decisions. PDF and Word for the review log (scope.md). These libraries should run inside the app and send no data to a third party. Confirm this when the libraries are chosen, because CLAUDE.md requires asking before adding a dependency that sends data to a new third party.
9. **Audit log.** Writes every view and export of a decision or review log (US-13, and the 2026-10-23 decision), every permission change (US-15), and every refused access (US-14).
10. **Sharing.** Creates expiring app-issued links for review logs. No public link works without sign-in (US-13).

**Limits to respect**
- Each server function runs under 300 seconds (P-1). Long work goes through the workflow.
- Batches are limited to 500 records. Larger files are refused and must be split (UC1).
- Five concurrent users, with headroom to 25 (P-4).

## Tier 3: Database

Supabase (PostgreSQL). Development and production are separate Supabase projects (O-5). Production holds only real review data. Every table has row-level security turned on.

**Tables**

| Table | What it holds | Rules |
|---|---|---|
| `users` | Profile linked to Supabase sign-in: name, email | Email and name are the only personal data (S-7, FR-DR-07) |
| `user_roles` | User type and permission level, with who assigned them and when | Only admins write. Changes are audited (US-15) |
| `source_snapshots` | The raw PubMed export file as uploaded, with its checksum | Kept for backups and audit (source snapshots in the database, decided 2026-10-28) |
| `records` | One row per PubMed record as it was screened: PMID, DOI, title, authors, year, journal, abstract | PMID is unique within a batch |
| `criteria_versions` | Criteria text, status (draft, approved, locked), drafter, approver, version number | Locked once any decision uses it (FR-DR-06). Drafter cannot approve (US-12) |
| `criteria_reasons` | The fixed reason list for each criteria version | Used for every decision reason (FR-DR-02) |
| `batches` | Name, source label (public or confidential), criteria version, two-reviewer setting, status, close time | Closed batches are read-only (US-08) |
| `batch_records` | Which records are in which batch, with the relevance score and its version | Relevance score is for ranking only (FR-DR-10, FR-DR-13) |
| `ai_proposals` (append-only) | Outcome, reason, criteria matched, and the full reproducibility set | No updates or deletes (T-2, FR-DR-05). Endpoint must be US (FR-DR-11) |
| `decision_events` (append-only) | Human decisions, overrides, corrections, queries, query responses, disagreement flags, and their resolutions. Each links to the event it corrects, if any | No updates or deletes (FR-DR-04). Corrections need a reason (US-11) |
| `audit_events` (append-only) | Who did what, when, and whether it was allowed or refused: views, exports, permission changes, refused access | No updates or deletes (T-2, US-14) |
| `spend_ledger` (append-only) | Cost of each AI call, with batch and time | Basis for the 80% alert (O-3) |
| `score_versions` | Relevance score versions and their calibration results | Decisions keep the version they were made under (US-20) |

**Enforcement**
- Updates and deletes on the append-only tables are blocked by database permissions and a trigger (ADR-0004). A test tries both and expects both to fail.
- Row-level security: a user sees a batch only if they are on it, and their permission level allows the action (US-14). A user without a batch gets no rows back, not an error.
- Times are stored in UTC (FR-DR-08).
- Encryption at rest: Supabase's setting still needs to be confirmed (S-3).

**Capacity**
- Designed for 100,000 records and their decisions (P-5). The event tables grow with every save, which is expected.

**Backups and recovery**
- Free Supabase plan for the prototype (ADR-0006). A-3 and A-1 need reworking before the first real review.
- Monthly restore test in a separate Supabase project (A-5).
- Audit tables are exported to long-term storage before the first real review (R-1).

## Decisions and open items

**Decided (ADRs)**
- ADR-0001: Next.js with Material UI.
- ADR-0002: Vercel, Supabase, and OpenRouter.
- ADR-0003: Supabase client for database access.
- ADR-0004: Decisions as append-only events.
- ADR-0005: Batch screening as a Vercel Workflow.
- ADR-0006: Free plans for the prototype.

**Still open, to decide before building the matching part**
1. The AI model for screening (test two or three on the same sample). Recorded as a new ADR when chosen.
2. The monthly AI cap (O-3), after the 20-record test batch.
3. Entry point for P2 (re-run and agreement). Not decided in the Figma file.
4. Admin screen design for US-15, query screen for US-16, and the disagreement flag for US-19.
5. Libraries for CSV, Excel, PDF, and Word export.
6. Supabase free-plan recovery approach, and the Vercel Hobby limits for workflows (see ADR-0006).

**Build order (after approval)**
1. Project scaffold, sign-in (S00), and the database migrations with the append-only rules and row-level security tests.
2. Import (S02, S03) and batches (S01, S04).
3. Criteria (S13) and the AI screening workflow, tested on the 20-record batch.
4. Screening queue, decisions, overrides, and closing (S06 to S09).
5. Find, history, and clinician queue (S10 to S12).
6. Review log sharing and exports (S14, exports).
7. Admin roles, queries, disagreement flags, sprint progress, and shortcuts (US-15 to US-19).
8. Calibration (US-20), once the labelled set exists.
