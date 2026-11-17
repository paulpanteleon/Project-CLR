# ADR-0020: A read-only review log per batch, shared through expiring links, with every view audited

## Date and status
2026-11-17. Accepted. Covers US-13, UC2 (steps 5 and 6, and the expired-link flow) and screen S14. Amends ADR-0019: views and searches of decisions are now audited. Builds on ADR-0016 (who can manage a batch) and ADR-0018 (storing only a key's hash).

## Context
Release 1 must let clinical affairs leads and clinician reviewers check the reasoning without rebuilding it (scope, outcome 5). The requirements set the rules for sharing (functional requirements, 2026-10-28):
- named users sign in with a role, or receive an app-issued link that expires;
- no public link works without sign-in;
- every view and export of a decision or review log is logged (2026-10-23).

ADR-0019 left decision views and searches unaudited, which did not meet the last rule.

The owner chose (2026-11-17):
- links can be named (one person) or open (anyone signed in with a role), chosen per link;
- a link opens the review log and each record's detail page only, not the rest of the batch;
- the batch's creator or an owner-level member creates links, as for managing members.

## Options
For how a link grants access:
- Option 1: Opening a link makes the person a temporary read-only member
  - Bad: they would reach the screening page, the export and Find decisions, which the owner did not want. Membership rules would need an expiry.
- Option 2: Every log and record read checks the link itself (chosen)
  - Good: access stops the moment a link expires or is withdrawn. Membership and row-level security are unchanged.

For how the link is stored:
- Option 1: Store the token
  - Bad: anyone who can read the table could use every link.
- Option 2: Store only its SHA-256 hash (chosen, as for run keys in ADR-0018)
  - Good: a stored row can't be turned back into a link. The full link is shown once, when it is created.

## Decision
- **`review_log_shares`** holds one row per link: batch, token hash, recipient email (empty for an open link), expiry (1, 7 or 30 days, at most 30), creator, and revocation. Rows are never deleted. Only revocation can change, once. Nobody reads the table directly.
- **Functions** (security definer, `search_path = ''`, not available to anon):
  - `create_review_log_share` and `revoke_review_log_share`: only someone who can manage the batch. A named link must name someone with an account and a role. Every attempt is audited.
  - `review_log_shares_for_batch`: a batch's links for its managers, with status and how often each was opened. Never the hash.
  - `review_log` and `record_decision_detail`: the log and one record's full history, as JSON. Reached by a member (no token) or through a link. A link must exist, be current, match the batch, and name the caller if it names anyone; the caller needs a role. Every call is audited as `review_log.view` or `decision.view`, allowed or not. The audit target names the share when one was used.
  - `find_decisions` (ADR-0019) now audits each search as `decision.search`.
- **Pages:**
  - `/batches/[id]/log`: the members' review log, reached from **Review log** on the batch page. For managers it also has **Share this review log**: an optional email, an expiry, **Create link**, and the list of links with **Withdraw** (with a confirmation).
  - `/shared/[token]` and `/shared/[token]/records/[pmid]`: the same log and record pages for link holders, with a notice saying the access is read-only, until when, and that views are recorded.
  - An unknown, expired, withdrawn or wrong-person link shows a refusal that says what to do, such as asking the batch owner for a new link (UC2). It never names the batch.
  - The members' record detail page now reads through `record_decision_detail`, so its views are audited too.
- **Sign-in:** someone who opens a link while signed out is sent through sign-in and the authenticator step as usual, then back to the link. The path is kept in a 30-minute, HTTP-only cookie, and only a well-formed `/shared/...` path is ever kept or followed.

## Consequences
- A reviewer can be given read access to one batch's reasoning for a set time, without joining the batch.
- An open link works for anyone in the prototype who has a role and gets hold of it. A named link is safer and is the first choice in the form's help text.
- The screening page and the export are unchanged. The screening page is the working queue and is not audited per view; the export was already audited (ADR-0017).
- `batch_people` (ADR-0019) is no longer called by the app. It is kept, since it still only answers members.
- PDF and Word export of the log is a separate task.
