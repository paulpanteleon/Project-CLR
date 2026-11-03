# Non-functional requirements

Draft v0.8, 2026-10-28, condensed for the repo. The source doc holds the full rationale. Status is one of: Proposed (not decided), Confirm (needs a decision), Confirmed, or Accepted concession (a lower standard accepted for the prototype).

## Decisions and stack

- **Stack:** Supabase (PostgreSQL and sign-in), Vercel (app, API, batch workflows), OpenRouter (Claude access, pay-as-you-go). Replaces the earlier Google Cloud proposal (2026-10-28).
- **Vercel plan:** Hobby, for personal non-commercial use. Switch to Pro before any work use, paid use, or sharing with a team (2026-10-28).
- **Supabase plan:** the owner plans to use the free plan as long as possible. **This conflicts with A-1 and A-3, which assume Pro.** See open questions.
- **Data routing:** all AI requests use one US-pinned route with no fallback outside the US. Confidential documents also require zero data retention on every request. Public PubMed records use the same route with logging off (2026-10-28).
- **Scale decisions:** up to 500 records screened within 60 minutes per batch (P-1). Design for 5 concurrent users with headroom to 25 (P-4) (2026-10-23).
- **Audit retention:** at least 10 years from the decision date (R-1) (2026-10-23).
- **AI budget:** monthly cap with an alert at 80%. The starting value is set after a 20-record test batch (O-3) (2026-10-23).
- **Accepted concessions (2026-10-28):** A-1 (no uptime SLA), O-1 (short log retention on Vercel Hobby), S-1 (email and MFA sign-in, not company SSO), R-4 (no SOC 2, HIPAA agreement, or ISO certificate for the prototype).

## Assumptions

- Internal prototype for a personal project that may never go to market. Formal validation (FDA 21 CFR Part 11, EU Annex 11) is not required, but the audit trail is designed so validation can be added later without rework.
- One developer and operator, with Claude's help. Managed services are preferred, and fewer vendors and settings are better.
- Cost is kept as low as possible.

## Traceability and data integrity

| ID | Requirement | Target | Status |
|---|---|---|---|
| T-1 | Every decision links to record, criteria version, reviewer, and timestamp | 100% have all links; a missing link is rejected | Proposed |
| T-2 | Audit events are append-only | No update or delete; corrections are new events. Enforced in the database | Proposed |
| T-3 | Each AI decision is reproducible | Store source snapshot, criteria version, prompt version, model ID, settings, raw output, upstream provider and endpoint, and ZDR status | Proposed (updated for OpenRouter) |
| T-4 | Records are attributable, legible, contemporaneous, original, and accurate (ALCOA+) | Written as design checks in the data model review | Proposed |

## Performance and capacity

| ID | Requirement | Target | Status |
|---|---|---|---|
| P-1 | AI first-pass screening of a batch | Up to 500 records within 60 minutes. Run as a Vercel Workflow, each step under the 300-second function limit | Confirmed (test pending) |
| P-2 | Interactive response for reviewers | Pages load within 2 seconds; saves complete within 1 second (95th percentile) | Proposed |
| P-3 | Single-record AI call | Average under 10 seconds per record | Proposed |
| P-4 | Concurrent users | 5 at once, headroom to 25 | Confirmed |
| P-5 | Stored records | Design for 100,000 records and their decisions | Proposed |

## Availability and recovery

| ID | Requirement | Target | Status |
|---|---|---|---|
| A-1 | Availability during the prototype | 99% per month as the working target | Accepted concession (no contractual uptime) |
| A-2 | Maintenance windows | Planned changes outside 08:00 to 18:00 in the team's time zone | Proposed |
| A-3 | Recovery point | 24 hours for the prototype, using Supabase Pro daily backups (7 days kept). Tightened to 1 hour, with point-in-time recovery, before the first real review | Confirmed |
| A-4 | Recovery time | 8 hours for the prototype | Proposed |
| A-5 | Restore testing | Monthly restore in a separate Supabase project, and after any major change | Proposed |
| A-6 | Rollback | Revert a bad release within 15 minutes using a previous Vercel deployment | Proposed |

## Security and privacy

| ID | Requirement | Target | Status |
|---|---|---|---|
| S-1 | Sign-in | Supabase email and MFA. Vercel Authentication on preview and production. Company SSO deferred | Accepted concession (prototype) |
| S-2 | Roles and permissions | Medical writer, clinician reviewer, and clinical affairs lead, enforced with Supabase row-level security | Proposed |
| S-3 | Encryption | TLS 1.3 in transit and AES-256 at rest (verified for Vercel). Supabase at-rest encryption still to confirm | Proposed |
| S-4 | Secrets | API keys and passwords in Vercel environment variables or Supabase's secret store, never in code or documents | Proposed |
| S-5 | Data classification | Each data source labelled public or confidential before loading | Confirmed |
| S-6 | AI provider data handling | Logging off in OpenRouter. Data processing agreement coverage confirmed in writing. ZDR enforced account-wide before any confidential document. Confirm upstream training terms for the pinned endpoint. OpenRouter content screening (from 27 October 2026) may keep flagged content for human review even under ZDR | Confirmed (actions pending) |
| S-7 | Personal data | Reviewer names and emails are the only personal data stored | Proposed |
| S-8 | Dependency scanning | Every change checked for known vulnerabilities (GitHub's free scanning) | Proposed |

## Retention and compliance

| ID | Requirement | Target | Status |
|---|---|---|---|
| R-1 | Audit event retention | At least 10 years from the decision date. Audit tables exported to long-term storage before the first real review, because backups are not an archive | Confirmed (archive plan pending) |
| R-2 | Data region | All data in the United States. Supabase and Vercel set to US regions. All AI requests pinned to US endpoints | Confirmed (endpoint names to verify) |
| R-3 | Interface accessibility | WCAG 2.1 AA, applied when screens are built | Proposed |
| R-4 | Certifications and agreements | Not needed for the prototype. Required before real pharmaceutical data beyond public records, or before work or commercial use | Accepted concession (prototype) |

## Observability, cost, and operations

| ID | Requirement | Target | Status |
|---|---|---|---|
| O-1 | Logs | Vercel Hobby keeps runtime logs 1 hour. Application errors and job status written to a Supabase table and kept there. Audit events follow R-1 | Accepted concession (prototype) |
| O-2 | Alerts | Failed batch jobs, error rate above 2% over 15 minutes, and AI provider outages | Proposed |
| O-3 | AI spending | Monthly cap with alert at 80%. Starting value about twice the expected monthly use, measured on a 20-record test batch. Enforced through OpenRouter's controls | Confirmed (value pending test) |
| O-4 | Deployment | Every change deployed through Vercel's Git integration, with a preview per change and production on approval | Proposed |
| O-5 | Environments | Development and production as separate Supabase projects. Production holds only real review data | Proposed |

## Open items from the NFR doc

1. Set the monthly AI budget cap (O-3) after a 20-record test batch. Confirm OpenRouter's spending controls.
2. Choose the screening model: test two or three on the same sample and pick the cheapest that meets the quality bar. This is the biggest cost lever.
3. Verify the US endpoints (R-2) and ZDR-eligible endpoints (S-6) on OpenRouter before the first confidential document.
4. Elect OpenRouter's data processing agreement coverage in writing (S-6).
5. Confirm Supabase encryption at rest and secret storage (S-3, S-4).
6. Check Vercel Hobby limits for Workflow events and data (P-1). Going over a Hobby limit pauses features for up to 30 days.
7. Set up the Supabase plan, then add point-in-time recovery before the first real review (A-3).
8. Decide what triggers the move to Vercel Pro: work use, paid use, sharing with a team, or the first real review.
