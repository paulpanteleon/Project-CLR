# ADR-0015: AI first-pass proposals per record, on one pinned route, stored as append-only proposals

## Date and status
2026-11-14. Accepted for the public-record test only. Builds on ADR-0004 (append-only events), ADR-0005 (batch AI screening), ADR-0010 (database functions for writes) and ADR-0014 (decisions bound to the batch criteria). Covers US-03, FR-DR-05, FR-DR-10, FR-DR-11, FR-DR-12 and T-3. Not yet covered: confidential batches, the Vercel Workflow for batches of up to 500, and the US routing check (see Consequences).

## Context
Each record in a batch needs an AI first pass against the batch's criteria. The proposal must show the criteria matched and the reason, with no confidence score (FR-DR-10). It must be stored with its full reproducibility set (FR-DR-05, T-3) before a reviewer sees it. Every request must use the US-pinned route, and a confidential source needs zero data retention on every request (FR-DR-11, FR-DR-12).

Checks run on 2026-11-14 against OpenRouter:
- Claude Haiku 5.5 and Claude Sonnet 5.5 are both offered. Each has US-tagged routes: Google Vertex (`google-vertex/us`), Azure (`azure/us`) and Amazon Bedrock (`amazon-bedrock/us-east-1`).
- Azure US returns no endpoint for zero retention, so it cannot be used.
- Google Vertex US and Amazon Bedrock us-east-1 both accepted a request with zero retention and no fallback. The generation record for each reports `data_region: "global"`. That field does not confirm US processing, and it may not reflect the route tag. **US processing is therefore not verified.** Open item R-2 remains open.

## Options
For the route:
- Option 1: Let OpenRouter choose the route
  - Bad: a request could go to a route outside the US.
- Option 2: Pin each request to one US-tagged route with no fallback, and zero retention on every request (chosen)
  - Good: the rule is enforced in the request, and the database refuses any stored proposal whose route is not the pinned one.
  - Bad: the US tag is trusted, not verified, until OpenRouter or the provider confirms it.

For the model:
- Haiku 5.5 and Sonnet 5.5 are both run on the same 20 public records, and the outputs are compared. The cheaper model is preferred if its quality is acceptable (NFR open item 2). The reviewer can see both proposals.

For storage:
- Option 1: Store only the decision the AI gave
  - Bad: fails the reproducibility rule (T-3).
- Option 2: A new append-only `ai_proposals` table with the full set, written by a database function (chosen)
  - Good: the rules hold even if the app is bypassed. Proposals cannot be edited, so a re-run is a new row, not a change to an old one.
  - Bad: each (batch, record, model, prompt version) can be proposed once. A new prompt version creates new proposals.

For the data flow:
- The app sends each record's title and abstract, and the criteria text, to the pinned route. Nothing else leaves the app.
- Proposals never create decisions. A reviewer records the decision, as before (ADR-0014).

## Decision
- **Route.** Every request is pinned to `amazon-bedrock/us-east-1`, with `allow_fallbacks: false`, `zdr: true` and `data_collection: "deny"`. Other routes are not used.
- **Public records only.** The first pass refuses a confidential batch. Confidential screening needs a verified US route with zero retention, which is not yet available.
- **Models.** `anthropic/claude-haiku-5.5` and `anthropic/claude-sonnet-5.5`, run on the same 20 records of the dev batch `pubmed-usingaiinr-set`, for comparison.
- **Output.** The model returns JSON: `outcome` (include, exclude, unsure or send_to_clinician), `reason_code` (from the batch's criteria), and `rationale` (quoting the supporting text). Output that does not parse, or that names a reason outside the criteria, is stored as `invalid` with its raw text. It is not shown as a proposal.
- **Reproducibility set.** Each proposal stores: batch, record, source snapshot, criteria version, prompt version (`first-pass-v1`), model ID, settings (temperature 0, max tokens), raw output, upstream provider reported by OpenRouter, the pinned route tag, zero-retention flag, the data region reported by OpenRouter, and the generation ID.
- **Database rules.** `ai_proposals` is append-only. The route tag must equal the pinned route. Zero retention must be true. A reason must come from the batch's criteria version. A proposal's record must be in the batch. The function refuses confidential batches.

## Consequences
- The proposals are for testing and comparison only. Do not use them for confidential documents, and do not describe the route as US-only, until the US routing is verified (R-2).
- The `data_region` stored is OpenRouter's report, which is `global` for both routes tested. It is kept so the question stays visible in the data.
- Vercel Workflow (ADR-0005) is not used yet. The 20-record run is a plain loop, one model call at a time.
- No confidence score is shown anywhere. The reviewer sees the outcome, the reason and the rationale for each model.
- Open items: confirm US processing with OpenRouter or the provider (R-2); confirm zero-retention enforcement for the pinned route (S-6); choose the model after the comparison and record it in a further ADR.
