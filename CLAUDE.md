# Project CLR

Project CLR is an AI literature assessment tool for medical writers doing device benefit-risk reviews. It applies one documented set of criteria to every clinical study and records the source text and reasoning behind each decision, so the evidence can be audited.

This is a personal, non-commercial prototype. It is built with Claude Code, and the owner is the sole developer and operator.

## Stack

- Next.js (app, review screens, API, batch workflows), deployed on Vercel Hobby
- Supabase (PostgreSQL database and sign-in), free plan for now
- OpenRouter (access to Claude), pay-as-you-go

## Where the detail lives

Read these before making product decisions:

- [docs/vision.md](docs/vision.md): why the product exists, who it is for, and the positioning
- [docs/scope.md](docs/scope.md): what is in Release 1 (the MVP) and what is out
- [docs/functional-requirements.md](docs/functional-requirements.md): user stories, use cases, and decision-record rules
- [docs/non-functional-requirements.md](docs/non-functional-requirements.md): performance, security, data routing, recovery, and cost targets
- [docs/open-questions.md](docs/open-questions.md): unresolved conflicts and decisions. Check this before building anything that touches them.

## Working rules

- Every screening decision is stored as an event. Never update or delete a decision or an AI proposal. A correction is a new event that points to the one it corrects.
- Every AI request uses the US-pinned route. Never send a request outside the United States, and never add a fallback outside it.
- Confidential sources also need zero data retention enforced on every request. Do not run a confidential batch without it.
- Store the full reproducibility set for every AI proposal (source snapshot, criteria version, prompt version, model ID, settings, raw output, upstream provider and endpoint, ZDR status) before a reviewer sees it.
- Do not show a confidence score for an AI decision. Show the criteria matched and the reason. The relevance score is shown for ranking only.
- Describe the product as a prototype. Do not use "validated" or "compliant" until the proof points in the vision doc pass.
- Ask before adding a paid service, changing the Supabase or Vercel plan, or adding a dependency that sends data to a new third party.
- Use Next.js conventions. Check the Next.js docs for the installed version before writing code that depends on version-specific behavior.
