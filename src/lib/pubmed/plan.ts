import { MAX_RECORDS_PER_BATCH, parsePubmedFile, type ParsedRecord } from "./parse";

// Decides what an import will save, using the rules in ADR-0010 and US-01:
// - No PubMed ID, or no title: rejected, and left out.
// - No abstract: flagged. Saved, and screened from the title.
// - A PubMed ID that appears again in the same file: a duplicate. The first copy is kept.
// - More than 500 records to save: the whole file is refused.

export type RejectedRecord = { pmid: string | null; reason: string };

export type ImportPlan = {
  // Set when the whole file cannot be imported. Nothing else is set in that case.
  error: string | null;
  records: ParsedRecord[];
  flaggedPmids: string[];
  rejected: RejectedRecord[];
  duplicates: string[];
};

const PUBMED_ID = /^\d+$/;

export function planPubmedImport(text: string): ImportPlan {
  const empty: ImportPlan = { error: null, records: [], flaggedPmids: [], rejected: [], duplicates: [] };
  const parsed = parsePubmedFile(text);

  if (parsed.length === 0) {
    return {
      ...empty,
      error: "No PubMed records were found. Check that the file is a PubMed export in MEDLINE format.",
    };
  }

  const plan: ImportPlan = { ...empty };
  const seen = new Set<string>();

  for (const record of parsed) {
    if (!PUBMED_ID.test(record.pmid)) {
      plan.rejected.push({ pmid: record.pmid || null, reason: "No PubMed ID" });
      continue;
    }
    if (!record.title) {
      plan.rejected.push({ pmid: record.pmid, reason: "No title" });
      continue;
    }
    if (seen.has(record.pmid)) {
      plan.duplicates.push(record.pmid);
      continue;
    }
    seen.add(record.pmid);
    plan.records.push(record);
    if (!record.abstract) {
      plan.flaggedPmids.push(record.pmid);
    }
  }

  if (plan.records.length === 0) {
    return { ...plan, error: "None of the records in this file can be imported." };
  }

  if (plan.records.length > MAX_RECORDS_PER_BATCH) {
    return {
      ...plan,
      error: `This file has ${plan.records.length} records to import. A batch holds up to ${MAX_RECORDS_PER_BATCH}. Split the export and import each part.`,
    };
  }

  return plan;
}
