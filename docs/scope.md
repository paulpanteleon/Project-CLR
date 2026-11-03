# Scope

## The problem and the outcomes

Medical writers screen several hundred PubMed records by hand, in spreadsheets, before the benefit-risk section is due. Manual screening consumes the review sprint. Reviewers, including clinical affairs leads and clinician reviewers, then question how a finding was reached, and the answer often sits in a personal spreadsheet.

Release 1 must:

1. Help medical writers finish title and abstract screening within one review sprint.
2. Help them apply the same criteria to every record.
3. Help them focus appraisal on the most likely relevant studies.
4. Help medical writers answer reviewer questions about any inclusion or exclusion decision within minutes.
5. Help clinical affairs leads and clinician reviewers check the reasoning without rebuilding it.
6. Help teams avoid rework caused by unexplained findings.

## Release 1 (in scope)

Prototype only, with PubMed records only.

### Epic 1: Screening that fits the review sprint

**Finish title and abstract screening within one review sprint**
- Import PubMed search results from a PubMed export file (MEDLINE-style), with PMID, title, abstract, and DOI
- Remove duplicate records across imports
- Build a batch screening queue with include, exclude, and maybe actions *(see open questions: "maybe" vs "unsure")*
- Add keyboard shortcuts for high-volume screening
- Show sprint progress: screened, remaining, and projected finish against the deadline
- Export screening decisions to CSV and Excel

**Apply the same criteria to every record**
- Define structured screening criteria: population, intervention, comparator, outcomes, design, and dates *(see open questions: criteria structure)*
- Version and lock criteria per review
- Record the criteria version on every screening decision
- Generate a first-pass decision and rationale per record against the criteria
- Require a logged reason that cites the criterion and the supporting text
- Test consistency by re-running the same records and comparing decisions

**Rank records so likely-relevant studies appear first**
- Define a relevance score from criteria match and study design *(see open questions: score vs no confidence score)*
- Sort the queue by score, with date as the tie-breaker
- Show the score and rationale on each queued record
- Calibrate the ranking against a human-labelled reference set

### Epic 2: Traceable decisions that reviewers can check

**Answer reviewer questions about any decision within minutes**
- Link each decision to criteria version, study metadata, reviewer, and timestamp
- Filter decisions by record, reviewer, decision, or criterion
- Build a decision detail view that shows the full reasoning chain

**Let clinical affairs leads and clinician reviewers check reasoning without rebuilding it**
- Create a shareable read-only review log
- Set reviewer roles: read-only, reviewer, owner *(see open questions: role model)*
- Export the review log to PDF and Word for submission packages

**Avoid rework cycles caused by unexplained findings**
- Raise a query on any decision and record the response
- Keep a change history (audit trail) for every decision edit
- Flag records where two reviewers disagree

## Later (out of scope for Release 1)

These are planned but not built in Release 1:

- API access for other tools (Elicit and Causaly offer this; not planned for Release 1)
- Literature sources beyond PubMed, including broad coverage such as Embase and Scopus
- Regulatory document generation
- Veeva Vault export
- Pricing and commercial features
- Company single sign-on
- Large-scale access beyond the prototype (see the NFR doc for the Vercel and Supabase upgrade triggers)

## Changes from earlier drafts

- The import method is a PubMed export file, not the NCBI E-utilities API. The release scope board still shows E-utilities and needs updating.
