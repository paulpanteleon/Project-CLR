# Open questions

Check this file before building anything that touches these items. Each one is a conflict between source docs or a decision still to make. Resolve each one, then update the relevant doc and delete the entry here.

## Conflicts between the release board and the functional docs

1. **Relevance score vs. no numeric confidence score.** The release board shows a relevance score on each queued record. FR-DR-10 says no numeric confidence score is shown, and the AI shows criteria and reason instead. Are the two the same thing? If not, what is the score based on, and does it need to be shown?
2. **Reviewer roles.** The board uses read-only, reviewer, and owner. The functional docs and S-2 use medical writer, clinician reviewer, and clinical affairs lead. Which model does Release 1 use, or do both apply?
3. **"Maybe" vs. "unsure."** The board's queue actions are include, exclude, and maybe. The decision record uses include, exclude, unsure, and send to clinician review. Which name is used in the product?
4. **Criteria structure.** The board defines criteria with population, intervention, comparator, outcomes, design, and dates. The use cases define criteria as a written topic and a fixed list of exclusion reasons. Are both needed, or does one replace the other?
5. **Export formats.** The board asks for CSV and Excel for screening decisions, and PDF and Word for the review log. The functional docs cover the review log but not the screening export. Confirm both sets.

## Items on the board with no functional requirement yet

These are in Release 1 on the board but not in the functional docs. Each needs a story or requirement before it is built:

- Raise a query on any decision and record the response
- Sprint progress view (screened, remaining, projected finish)
- Keyboard shortcuts for high-volume screening
- Flag records where two reviewers disagree
- Calibrate the ranking against a human-labelled reference set (also tied to the validation effort in the vision doc)
- Export to CSV and Excel

## Import method

- **Resolved:** PubMed export file, not the NCBI E-utilities API (decided 2026-11-03). The release board still shows E-utilities and needs updating.

## Plans and cost

- **Supabase free plan vs. the NFR doc.** The NFR doc assumes Supabase Pro for daily backups (A-3) and the 99% availability working target (A-1). The owner plans to stay on the free plan as long as possible. Check the current free-plan limits, including backups and project pausing. Decide how recovery works without Pro: manual exports, or a move to Pro at a defined trigger. Update A-1, A-3, and the operations plan to match.
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
