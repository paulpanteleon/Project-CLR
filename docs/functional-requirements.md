# Functional requirements

Prototype only, PubMed records only. The full Gherkin scenarios live in the source docs (User Stories and BDD, Use Cases, and Decision Record). The scenarios below are summaries. Turn them into automated tests when the feature is built.

**Actors:** medical writer (MW), clinician reviewer (CR), clinical affairs lead (CAL), AI screening (AI, system actor).

## Review topic

The review topic is "AI used to support clinical literature review." A record is in scope only if it describes AI or automation applied to finding, screening, appraising, or synthesizing clinical literature. AI used in clinical practice, nursing practice, or nursing education is out of scope, even when well evidenced. Criteria versions must state this topic in their own words, so every exclusion reason is traceable to a written rule.

## Decisions already made

- Import format: PubMed (MEDLINE-style) export file, not CSV (2026-10-25).
- A record marked "unsure" does not have to be resolved before its batch closes. It stays visible in the batch summary (2026-10-25).
- The person who drafted a criteria version cannot approve it (separation of duties) (2026-10-25).
- Criteria versions: the medical writer drafts, the clinical affairs lead approves, and approval is an audit event (2026-10-23).
- Every view and export of a decision or review log is logged in the audit history (2026-10-23).
- "Send to clinician review" is a fourth outcome, with its own clinician queue (2026-10-23).
- No AI confidence score on a decision. The AI shows criteria matched and a reason (2026-10-23). A relevance score is shown for ranking only (2026-11-03).
- User types are medical writer, clinician reviewer, and clinical affairs lead. Permission levels are read-only, reviewer, and owner. An admin assigns both (2026-11-03).
- Exports: screening decisions to CSV and Excel; review log to PDF and Word (2026-11-03).
- Exclusion and unsure reasons come from a fixed criteria list, with optional free text (2026-10-23).
- AI requests use only the US-pinned route. If unavailable, the batch pauses and may fall back only to other US-pinned endpoints (2026-10-28).
- Source snapshots are stored in the database, not file storage, so backups cover them (2026-10-28).
- Sharing a review log: named users sign in with a role, or receive an app-issued link that expires. No public link that works without sign-in (2026-10-28).
- Spend is tracked in the application's database, with an alert at 80% of the cap. OpenRouter's spending limits are a second check (2026-10-28).
- Sign-in uses email and multi-factor authentication, not company single sign-on, for the prototype (2026-10-28).
- Test batch: all six records in the test set are expected to be excluded under the review topic. The stroke review (PMID 41435444) is the closest call and should be checked specifically.

## User stories

| ID | Story (as a ..., I want ..., so that ...) | Key rules |
|---|---|---|
| US-01 | MW imports a PubMed export file, so its records can be screened | Source label required (public or confidential). Batches of 500 records or fewer. Duplicate PMIDs flagged. Records with no abstract accepted and marked. Raw file kept as a snapshot. |
| US-02 | MW applies an approved criteria version to a batch | Only approved versions selectable. Used versions are locked. Batch keeps its version. |
| US-03 | MW gets an AI proposal for every record in a batch | Full reproducibility set stored before display. Criteria and reason shown, no score. US-pinned route only. Confidential batches use zero-retention routes only. 500 records in 60 minutes. Failed records retried, then listed. Pause on route or usage-limit problems without losing records. Spend alert at 80% of cap. |
| US-04 | MW confirms an AI proposal in one step | Stores a human decision linked to the proposal. Save within 1 second (95th percentile). Reviewer identity comes from sign-in. |
| US-05 | MW overrides an AI proposal with a reason | Override stored, AI proposal kept unchanged. Exclusion cannot be saved without a reason from the criteria list. |
| US-06 | MW marks a record unsure or sends it to a clinician | Unsure shows the criteria it could not decide on. Clinician decisions go to the clinician queue with full history. Unsure does not block closing the batch. |
| US-07 | CR decides a record sent to review | Sees abstract, AI proposal, writer's decision, and criteria version. Decision stored as a new event. No access outside their batches. |
| US-08 | MW closes a batch when every record has a human decision | Cannot close with undecided records. Closed batches are read-only. Close is recorded. |
| US-09 | CAL finds a record by PubMed ID, title, or author and sees why it was decided | Results within 2 seconds (95th percentile). Unscreened records say so. |
| US-10 | Reviewer sees a decision's history in order | Shows AI proposal, human decision, override, and corrections, with actor and timestamp. Current outcome is the latest correction. |
| US-11 | MW corrects a saved decision by adding a new event | Original unchanged. Correction needs a reason. Nothing can be deleted. |
| US-12 | CAL approves a criteria version drafted by an MW | Approval stored as an audit event. Drafter cannot approve their own draft. |
| US-13 | CAL shares a read-only review log | Named users sign in. Expiring app-issued links. No public link without sign-in. Every view and export logged. |
| US-14 | Any user sees only the batches and actions their role allows | Refused access is recorded. Database enforces row-level security. |

## Use cases

**UC1: Screen a batch of PubMed records within a review sprint.** Goal: finish title and abstract screening for several hundred records with the same criteria. Preconditions: an approved, locked criteria version.

Main flow:
1. MW imports a PubMed export file and labels the source (public or confidential).
2. System checks each record for PubMed ID, title, and abstract, and lists any that are missing an item.
3. MW selects the criteria version for the batch.
4. AI runs a first pass on every record through the route that matches the source label, and stores each proposal with its reproducibility set.
5. System ranks records so likely-relevant ones appear first.
6. MW works the queue: confirms or overrides each proposal with a reason.
7. Records sent to clinician review move to the clinician queue.
8. MW closes the batch once every record has a human decision.

Alternate flows: no abstract (flag, screen from title); AI failures (retry, then list separately); US route unavailable (pause, no records lost); duplicate PubMed IDs (flag, ask MW to keep one); more than 500 records (refuse, split the export); off-topic records (AI proposes exclude with a criteria reason, which is the core of the use case); AI cannot place a record (proposes unsure); hosting usage limit reached (pause with cause and reset time, no records lost).

**UC2: Answer a reviewer's question about a decision.** Goal: answer any question about an include or exclude decision within minutes.

Main flow:
1. Actor searches by PubMed ID, title, or author.
2. System shows current outcome, reason, criteria version, reviewer, and timestamp.
3. Actor opens the decision history.
4. Actor opens the criteria version applied and the abstract as it was screened.
5. Actor shares a read-only review log with a named user or an expiring link.
6. Clinician reviewer checks flagged records and records a decision as a new event.

Alternate flows: never screened (say so and show the batch); corrections (show original and corrections in order); expired link (refuse, offer a new named-user link).

## Decision record

Every screening decision is stored as a decision record, whether the AI proposed it or a person made it.

**One decision contains:**
- Record reference: PubMed ID, DOI, title, authors, year, journal, and the abstract as it was when screened
- Criteria version
- AI proposal (when AI was used): outcome, reason, criteria matched, prompt version, model ID, settings, raw output, upstream provider and endpoint, and ZDR status
- Human decision: outcome, reason, reviewer name and email, timestamp (UTC)
- Override: whether the person changed the AI proposal, and why
- Event metadata: event ID, the event it corrects (if any), and when it was recorded

Outcomes for a human decision: include, exclude, unsure, send to clinician review.

**Requirements:**
- **FR-DR-01.** A decision is saved only with a record reference, criteria version, reviewer, and timestamp. Otherwise the save is refused and names the missing item.
- **FR-DR-02.** Every decision, including include, has a logged reason. Exclude and unsure require a reason from the criteria list, with optional free text.
- **FR-DR-03.** AI proposal and human decision are separate events. A human decision never overwrites an AI proposal.
- **FR-DR-04.** Decisions are never edited or deleted. A correction is a new event that points to the one it corrects.
- **FR-DR-05.** Every AI proposal is stored with its full reproducibility set before a reviewer sees it.
- **FR-DR-06.** A criteria version is locked once any decision uses it. Changes create a new version. Existing decisions keep their version.
- **FR-DR-07.** The only personal data stored in a decision record is the reviewer's name and email.
- **FR-DR-08.** Timestamps are stored in UTC and shown in the reviewer's local time.
- **FR-DR-09.** Records sent to clinician review are placed in a clinician queue showing full decision history.
- **FR-DR-10.** No AI confidence score on a decision. Show criteria matched and the reason. The relevance score is shown for ranking only and is not a confidence in the decision.
- **FR-DR-11.** Every AI request uses the US-pinned route. A proposal whose recorded endpoint is outside the US is refused and flagged.
- **FR-DR-12.** Confidential batches are screened only through a route with zero data retention enforced, and the proposal records that ZDR was enforced.
