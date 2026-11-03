# Open questions

Check this file before building anything that touches these items. Resolve each entry, update the relevant doc, then delete the entry here.

## Resolved (2026-11-03)

- **Relevance score:** shown on each queued record for ranking. It is not a confidence in the AI's decision (FR-DR-10, CLAUDE.md).
- **Roles:** user types are medical writer, clinician reviewer, and clinical affairs lead. Permission levels are read-only, reviewer, and owner. An admin assigns both (S-2, US-15).
- **"Unsure" vs. "maybe":** use "unsure" (scope.md).
- **Criteria structure:** PICO-style fields (scope.md).
- **Export formats:** screening decisions to CSV and Excel; review log to PDF and Word (scope.md, functional requirements).
- **Import method:** PubMed export file, not the NCBI E-utilities API. The release board still shows E-utilities and needs updating.
- **Board items with no story:** now covered by US-15 to US-20 (queries, sprint progress, keyboard shortcuts, disagreement flags, calibration). They are stories, not built yet.

## Proposed in the new stories, needs your decision

1. **Owner permission level.** US-15 and US-16 assume an owner can close queries, resolve disagreements, and (from earlier docs) close batches and share review logs. Confirm the owner's full set of rights.
2. **Reason for an include.** FR-DR-02 requires a reason for every decision, including include. Is an include reason chosen from the criteria list, or typed as free text?
3. **Two-reviewer screening.** US-19 needs two reviewers to screen the same record. Is this a batch setting? Are reviewers blind to each other's decision until both have decided?
4. **Projection rules.** Proposed: projection uses recent pace, and is withheld below 20 human decisions. Confirm both numbers and how "recent" is defined.
5. **Calibration set.** Proposed: at least 50 labelled records. Confirm the size and who creates the labels.

## Deferred

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
