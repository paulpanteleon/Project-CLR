// Reads a PubMed export file in MEDLINE format (US-01, ADR-0010).
//
// Each record starts with a PMID line. Each field is a short tag, a dash, and the value,
// for example "TI  - Title". A value can continue on following lines, which are indented
// by six spaces. Records are separated by blank lines.
//
// Only the fields the app stores are read. Everything else is ignored.

export type ParsedRecord = {
  pmid: string;
  doi: string | null;
  title: string | null;
  abstract: string | null;
  authors: string | null;
  journal: string | null;
  year: number | null;
};

export const MAX_RECORDS_PER_BATCH = 500;

const TAG_LINE = /^([A-Z][A-Z0-9]{1,3})\s*- ?(.*)$/;
const CONTINUATION = /^ {6}(.*)$/;

// Groups the lines of the file into fields per record.
function splitRecords(text: string): Array<Map<string, string[]>> {
  const records: Array<Map<string, string[]>> = [];
  let current: Map<string, string[]> | null = null;
  let lastTag: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") {
      // A blank line ends the record. Any tagged lines after it start a new record,
      // even when that record has no PubMed ID (it is then rejected, not dropped).
      current = null;
      lastTag = null;
      continue;
    }

    const tagMatch = TAG_LINE.exec(rawLine);
    if (tagMatch) {
      const [, tag, value] = tagMatch;
      if (tag === "PMID" || current === null) {
        current = new Map();
        records.push(current);
      }
      if (current) {
        const values = current.get(tag) ?? [];
        values.push(value.trim());
        current.set(tag, values);
      }
      lastTag = tag;
      continue;
    }

    const continuation = CONTINUATION.exec(rawLine);
    if (continuation && current && lastTag) {
      const values = current.get(lastTag);
      if (values && values.length > 0) {
        values[values.length - 1] = `${values[values.length - 1]} ${continuation[1].trim()}`;
      }
    }
    // Any other line is ignored.
  }

  return records;
}

function firstOf(fields: Map<string, string[]>, ...tags: string[]): string | null {
  for (const tag of tags) {
    const value = fields.get(tag)?.[0];
    if (value && value.trim() !== "") return value.trim();
  }
  return null;
}

function parseYear(dp: string | null): number | null {
  if (!dp) return null;
  const match = /\d{4}/.exec(dp);
  return match ? Number(match[0]) : null;
}

// Finds the DOI in the article-identifier fields, which look like "10.1000/xyz [doi]".
function parseDoi(fields: Map<string, string[]>): string | null {
  for (const tag of ["AID", "LID"]) {
    for (const value of fields.get(tag) ?? []) {
      if (value.endsWith("[doi]")) {
        return value.replace(/\s*\[doi\]$/, "").trim() || null;
      }
    }
  }
  return null;
}

function toRecord(fields: Map<string, string[]>): ParsedRecord {
  const abstract = firstOf(fields, "AB");
  const authors = fields.get("AU") ?? [];
  return {
    pmid: firstOf(fields, "PMID") ?? "",
    doi: parseDoi(fields),
    title: firstOf(fields, "TI"),
    abstract,
    authors: authors.length > 0 ? authors.join("; ") : null,
    journal: firstOf(fields, "TA", "JT"),
    year: parseYear(firstOf(fields, "DP")),
  };
}

// Returns every record in the file, in order, with no checks applied.
export function parsePubmedFile(text: string): ParsedRecord[] {
  return splitRecords(text).map(toRecord);
}
