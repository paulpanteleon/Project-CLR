# Vision

**Status:** prototype. Target claims below must not be published until the proof points pass.

## Vision statement

Project CLR lets medical writers judge every clinical study for a device benefit-risk review against the same written criteria, with each decision backed by its source text and reasoning, so the evidence base can stand up to audit.

## Primary audience

Medical writers who build device benefit-risk evidence. The product is for medical devices, not pharmaceuticals.

## Problem

Search tools find and cite studies, and regulatory writing tools generate documents. No product in the competitive matrix keeps a consistent, auditable applicability decision for each study. Judgements differ across studies and writers, and reviewers cannot see why a study was included or excluded.

## Unique value proposition

Every study in a device benefit-risk review is judged against the same written criteria, and every decision comes with the source text and reasoning that justify it.

## Positioning statement

For medical writers who build device benefit-risk evidence, Project CLR is an AI literature assessment tool that applies one documented set of applicability criteria to every clinical study and records the source text and reasoning behind each decision. Unlike Elicit, which searches and cites studies but shows no audit trail or QC validation, or Yseop, which generates regulatory documents but does not describe natural-language search or trial records, Project CLR makes each applicability call consistent, traceable and auditable.

## Competitors

Elicit and Yseop, with the other matrix products (Embase, Scopus, Causaly) as context. Elicit covers the search side and Yseop the audit and regulatory-output side. The gap sits between them.

## Where we would be unique (if the proof points pass)

- The only matrix product that combines cited search over clinical trial records with an audit trail and QC checks.
- Every study judged against the same written criteria, with the criteria version recorded on each decision.
- Each decision links to the exact source passage and the criterion it applied.
- Built for device benefit-risk work. No matrix competitor lists medical devices as a segment.
- A decision log built for quality review.
- Writers can override a decision, and the override and its reason are logged.

## Where competitors are still ahead

- Embase and Scopus have far broader literature coverage.
- Elicit and Causaly offer API access, which is not planned for Release 1.
- Yseop and Causaly export to Word. Word export is needed for workflow expectations, though it is not a differentiator.
- Natural-language search, citations, and structured summaries are standard across the matrix. They must meet a competitive standard but will not set the product apart.

## Proof points the prototype must show

Each claim needs a test the prototype can fail. **Thresholds are not set yet.** Agree them with medical writers before the prototype is shown.

| Claim | What the prototype must show | Measure | Threshold |
|---|---|---|---|
| Consistent decisions | Same study set and criteria give the same decision on repeat runs | Agreement rate across repeat runs | To be set |
| Matches expert judgement | Decisions match a writer's decisions on a labelled set of device studies | Agreement with a writer on a labelled set | To be set |
| Traceable | Every decision links to the criterion applied and the exact source passage | Share of decisions with a linked passage | To be set |
| Auditable | Every decision logged with date, criteria version and any reviewer override | Share of decisions with a complete log entry | To be set |
| Defensible summary | Each included and excluded study is cited in the benefit-risk summary | Share of summary statements with a citation | To be set |
| Faster | Time per study is shorter than manual review | Minutes per study against a writer's baseline | Baseline not yet measured |

Search with citations is parity with Elicit, not a differentiator. It needs to meet the competitive standard only.

## Market outcomes

Pilot teams use the product on live benefit-risk work. The time saved justifies wider rollout. Quality reviewers accept the decision log. The decision log is the proof point that most separates Project CLR from the matrix competitors.

| User need | Goal for the release | How we would measure it |
|---|---|---|
| Data extraction is slow and error-prone | Cut extraction time per study and reduce extraction errors | Minutes per study against a baseline timed with pilot writers; error rate on a checked sample |
| Judgements differ across studies and writers | Same criteria give the same decision on repeat runs, and writers agree with the tool | Repeat-run agreement; agreement with writers on a labelled set |
| Tight timelines | Writers reach a usable evaluation in one working session | Time from first upload to a complete, reviewable set of decisions |
| Low familiarity with review tools | A writer with no prior training runs an evaluation unaided | Share of pilot writers who finish a first evaluation without help |
| Decisions must be defensible | A quality reviewer reproduces a decision from its log without the writer present | Reviewer success rate on a sample of logged decisions |

Include device medical writers in the first pilot to test device-specific needs.

## Risks

- **Output reliability:** if the same study set gives different decisions on repeat runs, the consistency claim fails. Hallucinated citations would be worse, because a writer could submit an unsupported claim.
- **Validation effort:** a labelled set of device studies judged by writers is needed before any agreement rate means anything.
- **Regulatory expectations:** a tool that produces audit records may fall under computer system validation rules such as 21 CFR Part 11. A regulatory specialist should confirm which rules apply before any audit claims are made.
- **Trust and adoption:** experienced writers may distrust an AI-made applicability call.
- **Data access and rights:** full-text studies may be licensed in ways that restrict what can be loaded or stored.
- **Incumbents:** Elsevier and Clarivate have large databases and institutional relationships.
- **Narrow initial market:** a device-only focus limits the first customer base, and there is no pricing or buyer benchmark.
- **Scope and pricing:** scope is still being finalised and no pricing is set.
