# Open questions

Check this file before building anything that touches these items. Resolve each entry, update the relevant doc, then delete the entry here.

## Resolved (2026-11-03)

- **Relevance score:** shown on each queued record for ranking. It is not a confidence in the AI's decision (FR-DR-10, CLAUDE.md).
- **Roles:** user types are medical writer, clinician reviewer, and clinical affairs lead. Permission levels are read-only, reviewer, and owner. An admin assigns both (S-2, US-15).
- **Owner permission level:** confirmed as proposed in US-15 and US-16.
- **"Unsure" vs. "maybe":** use "unsure" (scope.md).
- **Criteria structure:** PICO-style fields (scope.md).
- **Reason for an include:** chosen from the criteria list, with optional free text. Every decision reason now comes from the list (FR-DR-02).
- **Two-reviewer screening:** a batch setting. Reviewers do not need to be blind to each other's decisions (US-19).
- **AI first-pass timing:** covered by P-1 (up to 500 records within 60 minutes).
- **Export formats:** screening decisions to CSV and Excel; review log to PDF and Word (scope.md, functional requirements).
- **Import method:** PubMed export file, not the NCBI E-utilities API.
- **Board items with no story:** covered by US-15 to US-20 (queries, sprint progress, keyboard shortcuts, disagreement flags, calibration). They are stories, not built yet.

## Needs your decision

None right now.

## Deferred

- **Sprint progress projection (US-17).** The projected finish of human screening against the sprint deadline. Only the counts are built for Release 1. When this is picked up, decide the pace window and the minimum number of decisions before a projection is shown.
- **Calibration set (US-20).** The size of the labelled set and who creates the labels. Proposed: at least 50 labelled records.
- **Supabase free plan vs. the NFR doc.** The NFR doc assumes Supabase Pro for daily backups (A-3) and the 99% availability working target (A-1). The owner plans to stay on the free plan as long as possible. Check the current free-plan limits, including backups and project pausing. Decide how recovery works without Pro, then update A-1, A-3, and the operations plan. *Owner will check this later.*
- **Vercel Hobby.** Allowed for personal, non-commercial use only. Confirm this remains true, and record the trigger for moving to Pro.

## Validation and proof points

- Agreement thresholds for every proof point in the vision doc are still unset. Agree them with medical writers before the prototype is shown.
- The labelled set of device studies is not built. Pilot writers may not have the expert time to build it.
- The regulatory specialist must confirm which rules apply (for example 21 CFR Part 11) before any audit claim is made.
- The applicability criteria must follow the device evidence framework the writers work under.
- The baseline for time per study is not measured yet.

## Data and compliance

- OpenRouter's content screening (from 27 October 2026) may keep flagged content for human review, even under zero data retention. Confirm what this means before any confidential document is loaded.
- Confirm OpenRouter's data processing agreement coverage in writing (S-6).
- Confirm Supabase encryption at rest (S-3).
- The model choice for screening is open. Test two or three models on the same sample.

## Test batch

- The stroke review (PMID 41435444) is the closest call. Its title says "systematized literature review," but its subject is AI in clinical stroke care. Check the first pass on this record specifically.
- The expected outcome for the six-record test batch is all excluded. The reason wording for the exclusion list is still to be finalised.
