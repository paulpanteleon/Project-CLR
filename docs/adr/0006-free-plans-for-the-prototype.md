# ADR-0006: Start on free plans for the prototype

## Date and status
2026-10-28. Accepted, with open items. Supabase plan decision still open (see the open questions doc).

## Context
This is a personal, non-commercial prototype with one developer. Paid plans are not justified yet. The NFR doc assumed Supabase Pro for daily backups (A-3) and a 99% working availability target (A-1). Vercel Hobby is allowed only for personal, non-commercial use.

## Options
- Option 1: Paid plans from the start (Vercel Pro, Supabase Pro)
  - Good: daily backups, point-in-time recovery, higher limits.
  - Bad: monthly cost for a prototype that may never be used by a team.
- Option 2: Free plans (Vercel Hobby, Supabase free), with upgrade triggers written down
  - Good: no monthly cost. Enough for one developer and a small test set.
  - Bad: no contractual uptime. Logs kept for 1 hour on Vercel Hobby (O-1). Free-plan limits apply to workflows and data. Backup and recovery are weaker (A-3 must be changed or reworked).

## Decision
Use Option 2 for the prototype. Accepted concessions: A-1 (no uptime SLA), O-1 (short log retention), S-1 (email and multi-factor sign-in, not company SSO), R-4 (no SOC 2, HIPAA agreement, or ISO certificate).

Upgrade triggers, from the NFR doc: work use, paid use, sharing with a team, or the first real review. Move to paid plans before any of these.

## Consequences
- Before the first real review, decide how recovery works on the free plan, and update A-1, A-3, and the operations plan.
- Check the current free-plan limits for Supabase (backups, project pausing) and Vercel Hobby (workflow events and data).
- Next steps: confirm the Vercel Hobby use terms and record the upgrade trigger (both are listed in `docs/open-questions.md`).
