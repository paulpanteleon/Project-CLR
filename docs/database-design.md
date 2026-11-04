# Database design

Status: draft, 2026-11-04. Describes the tables in `supabase/migrations/` (core schema, and source files and records), plus the tables planned in `docs/architecture/plan.md` (tier 3). Planned tables are marked **Planned** and are not in a migration yet.

Diagram: `docs/database-diagram.md`.

## What does the app need to save?

- **Who each user is and what they may do:** each person's user type, permission level, and who gave them those rights and when.
- **Which batches exist:** each batch's name, source label (public or confidential), status, and creator.
- **Who can work on each batch:** the list of people allowed to see and act on each batch.
- **The PubMed records:** each record's PubMed ID, DOI, title, authors, year, journal, and abstract as it was screened.
- **The raw import file:** the PubMed export file exactly as uploaded, kept so the import can be checked later.
- **The criteria versions:** the written screening rules for a review, with their status (draft, approved, locked) and who drafted and approved them.
- **The reasons list:** the fixed list of reasons a record can be included or excluded, tied to each criteria version.
- **Which records are in which batch:** each record's place in a batch, with its relevance score and the score version.
- **The AI's proposals:** each proposed outcome, reason, and criteria matched, with the full record of how it was produced.
- **Human decisions:** each reviewer's include, exclude, unsure, or send-to-clinician decision, with reason and time.
- **Overrides and corrections:** when a reviewer changes an AI proposal or a saved decision, and why.
- **Queries and answers:** questions raised about a decision, and the replies.
- **Disagreements:** when two reviewers decide differently on the same record, and how it was resolved.
- **Who did what:** a log of sign-ins, permission changes, exports, views, refused access, and multi-factor checks.
- **AI spending:** the cost of each AI call, for the monthly cap and the 80% alert.
- **Relevance score versions and calibration results:** so each decision can show which score version it was made under.

## Tables

### Table name: user_roles

**What it stores:** each signed-in person's user type and permission level. One row per person.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| user_id | uuid | Yes | The person this row belongs to. Points to their sign-in account. Also the primary key, so each person has one row. |
| user_type | text | Yes | Their job role: medical_writer, clinician_reviewer, or clinical_affairs_lead. |
| permission_level | text | Yes | What they may do: read_only, reviewer, or owner. |
| assigned_by | uuid | No | The person who gave them this role. |
| assigned_at | date and time | Yes | When the role was given. Defaults to now. |

**Who can see it?** Each person can see only their own row.

**Who can add, change, or delete it?** Nobody through the app yet. Changes will go through an admin path that is not built yet (ADR-0008). That path must record each change in the audit log (US-15).

### Table name: batches

**What it stores:** each screening batch: its name, where its records came from, whether it is open, and who created it.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code for each batch. Created automatically. |
| name | text | Yes | The batch's name. Cannot be blank. |
| source_label | text | Yes | public or confidential. Decides which AI route the batch may use (FR-DR-12). |
| status | text | Yes | open or closed. Defaults to open. |
| created_by | uuid | Yes | The person who created the batch. Defaults to the signed-in person. |
| created_at | date and time | Yes | When the batch was created. |

**Who can see it?** Only people listed as members of the batch.

**Who can add, change, or delete it?** Anyone signed in can add a batch, but only as themselves. The app must supply the batch's id itself and read the batch back in a separate step. The creator is added as the first member automatically. Nobody can change or delete a batch through the app yet. Closing a batch (US-08) is not built.

### Table name: batch_members

**What it stores:** which people may work on which batch. One row for each person in each batch.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| batch_id | uuid | Yes | The batch. Together with user_id, this is the primary key. |
| user_id | uuid | Yes | The person who is a member of the batch. |

**Who can see it?** Each person can see only their own memberships.

**Who can add, change, or delete it?** The batch's creator is added automatically when the batch is created. Adding or removing other members is not built yet. Membership decides who can see each batch (US-14), so this needs an admin or batch-owner path.

### Table name: decision_events

**What it stores:** every human decision, override, correction, query, and reply, one row per event. Rows are never changed or deleted (FR-DR-04).

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code for each event. |
| batch_id | uuid | Yes | The batch the record belongs to. |
| record_pmid | text | Yes | The PubMed ID of the record decided. |
| kind | text | Yes | human_decision, override, correction, query, query_response, dispute_flag (two reviewers disagree), or resolution (an owner settles a flag). |
| outcome | text | Required for decisions and resolutions | include, exclude, unsure, or send_to_clinician. Not needed for queries, replies, or flags. |
| reason_code | text | Required for decisions and resolutions | The reason, taken from the criteria reasons list. Not needed for queries, replies, or flags. |
| free_text | text | No | Extra detail the reviewer adds. |
| criteria_version | text | Yes | The criteria version in use when the decision was made. Planned to become a link to the criteria versions table. |
| corrects_event_id | uuid | Required for corrections and resolutions | The earlier event this one replaces (a correction) or settles (a resolution, which points at its dispute flag). Must be in the same batch. |
| actor_id | uuid | Yes | The person who recorded the event. Must be the signed-in person. |
| recorded_at | date and time | Yes | When the event was recorded (UTC). |

**Who can see it?** Anyone who is a member of the batch.

**Who can add, change, or delete it?** Members with reviewer or owner permission can add events, and only as themselves. Read-only members cannot add. Only owners can add a resolution (US-19). Nobody can change or delete an event: the database refuses it, even for an owner.

### Table name: audit_events

**What it stores:** a log of who did what, and whether the action was allowed. Rows are never changed or deleted.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code for each log entry. |
| actor_id | uuid | No | The person who acted. Empty only if the person was not known. |
| action | text | Yes | What happened, such as mfa.verify.success or mfa.verify.failure. |
| target | text | No | What it happened to, such as mfa or a batch. |
| allowed | true or false | Yes | Whether the action was allowed. A refused attempt is logged with false. |
| occurred_at | date and time | Yes | When it happened. |

**Who can see it?** Each person can see their own entries. Owners can see all entries.

**Who can add, change, or delete it?** Any signed-in person can add an entry, but only as themselves. Nobody can change or delete an entry: the database refuses it.

### Table name: source_snapshots

**What it stores:** the PubMed export file exactly as uploaded to a batch, with its checksum. Kept in the database so backups cover it (decided 2026-10-28). Migration: `20261104010000_records.sql`.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code for each upload. |
| batch_id | uuid | Yes | The batch the file was loaded into. |
| file_name | text | Yes | The file's name as uploaded. |
| file_text | text | Yes | The file's contents as uploaded. |
| checksum | text | Yes | SHA-256 fingerprint of the file, as 64 lowercase hex characters. Set by the app at upload. |
| uploaded_by | uuid | Yes | The person who uploaded it. Defaults to the signed-in person. |
| uploaded_at | date and time | Yes | When it was uploaded. |

**Who can see it?** Members of the batch.

**Who can add, change, or delete it?** Reviewers and owners can upload, and only as themselves. Nobody can change or delete a file: the database refuses it.

### Table name: records

**What it stores:** each PubMed record as it was screened in one batch. One copy per PubMed ID per batch, so the same article can appear in several batches, each with its own row. Migration: `20261104010000_records.sql`.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code for each record row. |
| batch_id | uuid | Yes | The batch the record was imported into. |
| source_snapshot_id | uuid | Yes | The uploaded file the record came from. Must be in the same batch. |
| pmid | text | Yes | The PubMed ID. Digits only. Unique within a batch. |
| doi | text | No | The DOI, if PubMed has one. |
| title | text | Yes | The article title. A record without one is refused. |
| abstract | text | No | The abstract. Missing abstracts are accepted and flagged, so they are screened from the title (UC1). |
| authors | text | No | The author list. |
| journal | text | No | The journal name. |
| year | number | No | Publication year, from 1800 to 2200. |
| created_at | date and time | Yes | When the row was added. |

**Who can see it?** Members of the batch.

**Who can add, change, or delete it?** Reviewers and owners can add records. Nobody can change or delete a record: the database refuses it. A duplicate PubMed ID in one batch is refused, so the import must have the reviewer keep one copy first (UC1).

### Table name: criteria_versions (Planned)

**What it stores:** each version of the screening criteria for a review, with its approval status.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code. |
| review_name | text | Yes | The review the criteria apply to. |
| version_number | number | Yes | 1, 2, 3, and so on. |
| criteria_text | text | Yes | The written rules, including the review topic. |
| status | text | Yes | draft, approved, or locked. Locked once any decision uses it (FR-DR-06). |
| drafted_by, approved_by | uuid | Drafted by: Yes. Approved by: once approved | Who wrote it and who approved it. The drafter cannot approve (US-12). |

Who can see it: all signed-in members of a batch that uses it. Who can change it: the medical writer drafts; the clinical affairs lead approves. Approval is logged in the audit table.

### Table name: criteria_reasons (Planned)

**What it stores:** the fixed list of reasons a record can be included or excluded, for each criteria version.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| criteria_version_id | uuid | Yes | The criteria version the reason belongs to. |
| code | text | Yes | A short code such as R-TOPIC-OK. Used in decision_events.reason_code. |
| label | text | Yes | The reason as a sentence. |

Who can see it: anyone who can see the criteria version. Who can change it: nobody, once the version is locked.

### Table name: ai_proposals (Planned)

**What it stores:** each AI proposal, with everything needed to reproduce it (T-3). Append-only.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code. |
| batch_id, record_pmid | uuid, text | Yes | The batch and record. |
| outcome, reason_code, criteria_matched | text | Yes | The proposed outcome, reason, and criteria met. No confidence score (FR-DR-10). |
| criteria_version_id, prompt_version, model_id, settings | text | Yes | How the proposal was made. |
| raw_output | text | Yes | The AI's full reply. |
| provider, endpoint | text | Yes | Which provider and endpoint answered. The endpoint must be in the US (FR-DR-11). |
| zdr_enforced | true or false | Yes | Whether zero data retention was enforced (FR-DR-12). |
| source_snapshot | text | Yes | The record text sent to the AI, as it was (FR-DR-05). |
| created_at | date and time | Yes | When it was made. |

Who can see it: members of the batch. Who can change it: nobody.

### Table name: batch_records (Planned)

**What it stores:** which records are in which batch, and each record's relevance score for ranking.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| batch_id, record_pmid | uuid, text | Yes | Together, the primary key. |
| relevance_score | number | No | Used only for ranking (FR-DR-10). |
| score_version_id | uuid | Required when a score is set | The score version used (FR-DR-13). |

Who can see it: members of the batch. Who can change it: the system, when ranking runs.

### Table name: score_versions (Planned)

**What it stores:** each version of the relevance score and its calibration results (US-20).

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code. |
| version_number | number | Yes | Version order. |
| formula_text | text | Yes | How the score is worked out. |
| agreement_with_labels | number | No | The share of labelled records the ranking agrees with. |
| created_by, created_at | uuid, date and time | Yes | Who saved the version, and when. |

Who can see it: owners and clinical affairs leads. Who can change it: nobody. Append-only.

### Table name: spend_ledger (Planned)

**What it stores:** the cost of each AI call, for the monthly cap and the 80% alert (O-3). Append-only.

| Column name | Type of data | Required? | What it means |
| --- | --- | --- | --- |
| id | uuid | Yes | A unique code. |
| batch_id | uuid | Yes | The batch the call was for. |
| cost_usd | number | Yes | What the call cost. |
| occurred_at | date and time | Yes | When the call happened. |

Who can see it: owners. Who can change it: nobody.

## How the tables connect

- One person can have one role row. Each role row belongs to one person.
- One batch can have many members. Each membership row links one person to one batch.
- One batch can have many decision events. Each decision event belongs to one batch.
- One decision event can be corrected by many later events, but each correction points to exactly one earlier event in the same batch.
- One dispute flag can be settled by one resolution, which points at that flag.
- One audit entry records one action by one person, and that person may have many entries.
- One batch can have many source uploads. Each upload holds many records, and each record belongs to one upload in the same batch.
- One batch can have many records. Each PubMed ID appears once per batch, with a separate row in each batch that contains it.
- *(Planned)* One criteria version has many reasons. Each decision uses one criteria version and one reason from it.
- *(Planned)* One record in one batch can have many AI proposals, but each proposal belongs to one record in one batch.

## Access rules

Supabase calls these Row Level Security, or RLS. Supabase says to turn on RLS for every table in an exposed schema.

- [x] RLS is turned on for every table in the migrations (user_roles, batches, batch_members, decision_events, audit_events, source_snapshots, records). Planned tables are not yet created.
- [x] Each table has a rule that limits what each person can see. Batch data, files, and records are limited to batch members. The user_roles, batch_members, and audit_events rows are limited to their own, with owners seeing all audit entries.
- [ ] I tested this with two accounts. **Not yet.** The tests in `tests/db/` simulate two or more signed-in users on a local PostgreSQL. They have not run against a real Supabase project with two real accounts.

## Database diagram

Way 2: Mermaid diagram in `docs/database-diagram.md`.

## Migration files

- [x] Every change to the database is saved as a SQL migration file in the repository. Current files: `supabase/migrations/20261104000000_core_schema.sql` and `supabase/migrations/20261104010000_records.sql`. Migrations run in filename order.
- [x] I can tell what each migration file does from its name. The names are a date and a short description ("core_schema", "records"). Later migrations will name each change (for example, `add_criteria_versions`).

## Resolved in the schema fixes (2026-11-04)

1. **Batch creators could not read their own batch.** A trigger now adds the creator as the first member. The app must choose the batch id itself and read the batch in a separate step, because the membership is added after the insert.
2. **Corrections could point to events in another batch.** A database rule now requires the earlier event to be in the same batch.
3. **Missing event kinds.** `dispute_flag` and `resolution` are now allowed. A flag needs no outcome or reason. A resolution needs an outcome, a reason, and a pointer to its flag.

## Open items to decide before creating the tables

1. **criteria_version is text, not a link.** It should point to `criteria_versions` once that table exists.
3. **A resolution links to one flag only.** US-19 says a resolution links to both decisions. The flag can carry that link, or a second pointer can be added. Decide when the disagreement feature is built.
4. **Who manages batch members and roles?** The admin path is not designed yet (ADR-0008).
5. **Supabase's own auth user table is the people table.** This is deliberate. No separate people table is needed. Confirm this is OK.
