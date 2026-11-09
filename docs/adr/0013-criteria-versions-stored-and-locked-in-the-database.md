# ADR-0013: Store criteria versions in the database, with approval and locking enforced there

## Date and status
2026-11-09. Accepted. Builds the criteria part of the first build (US-02, US-12, FR-DR-02, FR-DR-06, S13 in `docs/architecture/plan.md`).

## Context
Every screening decision must cite the criteria version it used, and the reasons it can give must come from a fixed list for that version (FR-DR-02). Criteria are drafted by a medical writer and approved by a clinical affairs lead, and the drafter cannot approve their own draft (US-12). Once a version is used, its text must not change (FR-DR-06). Before this change, `decision_events.criteria_version` was free text and nothing held the criteria themselves.

## Options
For how the criteria are stored:
- Option 1: One text block per version, with the reasons written inside it
  - Good: simplest to write.
  - Bad: the reason list cannot be checked, and a decision cannot be tied to one reason.
- Option 2: Structured columns for the review topic and the PICO-style fields (population, intervention, comparator, outcomes, design, dates), and a separate reasons table (chosen)
  - Good: each field can be shown, checked and compared. Each reason has a code that decisions can refer to.
  - Bad: a change to the field list needs a new migration.
- Option 3: A JSON column holding all the fields
  - Good: no migration for each new field.
  - Bad: no column-level checks, and the reason codes cannot be linked to decisions.

For where the rules are enforced:
- Option 1: In the app only
  - Bad: the app can be bypassed, and the approval rule could be broken by a direct write.
- Option 2: In the database, with the app calling functions (chosen, the same approach as ADR-0010 and ADR-0012)
  - Good: the rules hold even if the app is bypassed. Denied attempts are written to the audit log.
  - Bad: the rules live in SQL as well as in the app.

For separation of duties:
- The function checks the caller's user type. A medical writer drafts and a clinical affairs lead approves. The drafter cannot approve, which is checked both in the function and by a table constraint.
- Owner permission is not enough to draft or approve on its own. Owners are the admins (ADR-0011), and the review roles stay separate.

## Decision
- **Tables.** `criteria_versions` holds one row per version: review name, version number, review topic, the six PICO-style fields, status (draft, approved or locked), who drafted it and when, and who approved it and when. `criteria_reasons` holds the reason codes and labels for each version.
- **Writing.** No direct writes are allowed. The app calls `create_criteria_version` (draft), `approve_criteria_version` and `lock_criteria_version`. Each returns a result word and writes an audit row. The app chooses the new version's id, as it does for batches (ADR-0010).
- **Locking.** The status moves only draft to approved and approved to locked. A trigger refuses any change to the text, the approval, or the reasons once a version is no longer a draft. Versions are never deleted. A change to the criteria is a new version with the next number for the review.
- **Locking on use.** `lock_criteria_version` exists now. The decision step will call it when the first decision uses a version. The batch step will also need a link from a batch to its criteria version.
- **Visibility.** Signed-in users with a role see approved and locked versions. A draft is visible only to its drafter and to clinical affairs leads.

## Consequences
- The rules are enforced in the database and tested in `tests/db/criteria-versions.test.ts`. A mutation check confirmed the tests fail when the reason guard is removed.
- Drafts cannot be edited. A mistake in a draft is fixed by drafting a new version, which keeps the history simple.
- Only medical writers can draft and only clinical affairs leads can approve or lock. A person who is both needs two user types, which is not possible in one role row (ADR-0008, US-15). If that happens, a new decision is needed.
- `decision_events.criteria_version` is still free text. Linking it to `criteria_versions` is the next step (open item 1 in `docs/database-design.md`).
- Not covered yet: the screen for listing and approving versions is basic. It needs a live test on the dev project with two accounts (a medical writer and a clinical affairs lead) before real review use, as with the earlier migrations.
