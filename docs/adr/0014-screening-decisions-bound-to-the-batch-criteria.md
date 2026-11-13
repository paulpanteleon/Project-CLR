# ADR-0014: Screening decisions bound to the batch's criteria version, with corrections as events

## Date and status
2026-11-10. Accepted. Builds on ADR-0004 (append-only events), ADR-0010 (database functions for writes) and ADR-0013 (criteria versions). Covers US-02, US-04, US-05, US-10, US-11, FR-DR-01, FR-DR-02 and FR-DR-06.

## Context
A screening decision must say which criteria version it used, and its reason must come from that version's list (FR-DR-02, FR-DR-06). Before this change, the decision table held the version as free text, the batch had no criteria version, and nothing stopped a decision from using a reason that did not belong to the criteria in force.

## Options
For where the criteria version comes from:
- Option 1: The app sends the version with each decision
  - Bad: a caller can send any version, including one that is not the batch's.
- Option 2: The batch holds one version, set before the first decision. The decision function reads it from the batch (chosen)
  - Good: every decision in a batch uses the same version. The caller cannot choose another.
  - Bad: the batch's version cannot change once screening starts, so a wrong choice means a new batch.

For writes:
- Option 1: The app inserts rows directly, relying on row-level security
  - Bad: the app can skip the version, the lock and the reason checks.
- Option 2: Database functions for recording, correcting and setting the batch version (chosen, as ADR-0010 and ADR-0012)
  - Good: the rules hold even if the app is bypassed. Denied attempts are recorded.
  - Bad: the rules live in SQL as well as in the app. Direct inserts are still permitted by row-level security, so they must be checked by the new constraints.

For corrections:
- Option 1: Edit or replace a decision
  - Bad: breaks append-only rules (ADR-0004).
- Option 2: A new event that points at the one it corrects, with a required reason (chosen)
  - Good: the history is kept, and the current outcome is the latest event.
  - Bad: two people could correct the same event at once. A unique index on the corrected event stops that.

For locking:
- The version locks the first time a decision uses it (FR-DR-06). The decision function does this in the same step, so there is no gap in which the version could change under a decision.

## Decision
- **Batch version.** `batches.criteria_version_id` is set by `set_batch_criteria`. Only a reviewer or owner can set it, only on an open batch, only to an approved or locked version, and only before a decision exists.
- **Decisions.** `record_screening_decision` takes the batch, record, outcome (include, exclude, unsure or send to clinician), reason and free text. It uses the batch's version, checks the record is in the batch, and writes a `human_decision` event. It then locks the version if it is still approved. A denied attempt is audited.
- **Reasons.** A composite foreign key ties each decision's reason to its own version, so a reason from another version is refused.
- **Corrections.** `correct_screening_decision` adds a `correction` event pointing at an earlier event. It needs a reason in free text. Only the latest event for a record can be corrected, and a unique index allows only one correction per event.
- **Current outcome.** The view `current_screening_outcomes` shows the latest decision or correction per record. It reads through the same row-level rules as the events.
- **Legacy row.** The one earlier test row on dev has a free-text version, `v1`. It is kept, because the table is append-only. The new check on criteria versions is added as NOT VALID, so the row is not checked.

## Consequences
- Tests in `tests/db/screening-decisions.test.ts` cover the rules, and a mutation check confirmed the locking test fails when the lock is removed.
- The app records and corrects decisions through the functions only. Direct inserts are still allowed by row-level security, but they must now name a version and a reason from it.
- The batch's version cannot change after the first decision. Changing it needs a new batch.
- Decisions show the reviewer's identity only as "you" or "another reviewer" in the app. Showing names would need the secret key in another place, which ADR-0012 limits to two uses.
- Not yet built: the two-reviewer setting, closing a batch (S09), and keyboard shortcuts and sprint progress (step 4).

## Amendment (2026-11-13): supporting text and the record link
- **Supporting text.** Each decision needs supporting text from the record, a quote or summary that backs the reason (US-04, FR-DR-02). The database refuses a blank one, and the form marks the field as required. A correction already needed a reason in free text, so it is covered by the same check. The check is `decision_supporting_text_required`, added as NOT VALID so the one earlier test row is not checked.
- **Record link.** A composite foreign key ties each decision to its record in the same batch (`decision_record_in_batch`). The record's title, DOI, journal, year and abstract are then the study details for the decision. A record cannot be deleted while a decision points at it. Also added as NOT VALID for the earlier test row.
- **Why not copy the record into the decision.** Records are written once on import and never change, so a link keeps one copy of the study details. Copying them would mean two copies to keep in step.
- **Migration.** `20261112000000_decision_supporting_text_and_record_link.sql` redefines `record_screening_decision` to check the supporting text. The correction function already checked its free text and is unchanged.
