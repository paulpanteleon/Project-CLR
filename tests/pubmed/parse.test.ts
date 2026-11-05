import { describe, expect, it } from "vitest";
import { parsePubmedFile } from "@/lib/pubmed/parse";
import { planPubmedImport } from "@/lib/pubmed/plan";

// A small MEDLINE export. The values are invented test data, not real study records.
const SAMPLE = `PMID- 70000001
OWN - NLM
STAT- MEDLINE
DP  - 2025 Mar
TI  - An example title that continues
      onto a second line.
AB  - The first line of the abstract
      and its second line.
AU  - Writer A
AU  - Writer B
TA  - Test Journal
AID - 10.1000/example.001 [doi]
AID - S0000-0000(25)00001-0 [pii]

PMID- 70000002
DP  - 2024
TI  - A record with no abstract
TA  - Test Journal
`;

describe("MEDLINE parser (US-01)", () => {
  it("reads the fields the app stores, including values that continue on the next line", () => {
    const [first] = parsePubmedFile(SAMPLE);
    expect(first).toEqual({
      pmid: "70000001",
      doi: "10.1000/example.001",
      title: "An example title that continues onto a second line.",
      abstract: "The first line of the abstract and its second line.",
      authors: "Writer A; Writer B",
      journal: "Test Journal",
      year: 2025,
    });
  });

  it("reads a record with no abstract, no authors, and no DOI", () => {
    const records = parsePubmedFile(SAMPLE);
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual({
      pmid: "70000002",
      doi: null,
      title: "A record with no abstract",
      abstract: null,
      authors: null,
      journal: "Test Journal",
      year: 2024,
    });
  });

  it("handles Windows line endings", () => {
    const records = parsePubmedFile(SAMPLE.replace(/\n/g, "\r\n"));
    expect(records.map((r) => r.pmid)).toEqual(["70000001", "70000002"]);
    expect(records[0].title).toBe("An example title that continues onto a second line.");
  });

  it("returns nothing for a file with no PubMed records", () => {
    expect(parsePubmedFile("this is not a PubMed file\n")).toEqual([]);
  });
});

describe("import plan (US-01, ADR-0010)", () => {
  it("saves records, flags those with no abstract, and reports the counts", () => {
    const plan = planPubmedImport(SAMPLE);
    expect(plan.error).toBeNull();
    expect(plan.records.map((r) => r.pmid)).toEqual(["70000001", "70000002"]);
    expect(plan.flaggedPmids).toEqual(["70000002"]);
    expect(plan.rejected).toEqual([]);
    expect(plan.duplicates).toEqual([]);
  });

  it("rejects a record with no PubMed ID or no title", () => {
    const text = `TI  - Title without an ID

PMID- 70000003
DP  - 2025
`;
    const plan = planPubmedImport(text);
    expect(plan.rejected).toEqual([
      { pmid: null, reason: "No PubMed ID" },
      { pmid: "70000003", reason: "No title" },
    ]);
    expect(plan.error).toBe("None of the records in this file can be imported.");
  });

  it("rejects a PubMed ID that is not a number", () => {
    const text = `PMID- ABC-1
TI  - Bad ID
`;
    expect(planPubmedImport(text).rejected).toEqual([{ pmid: "ABC-1", reason: "No PubMed ID" }]);
  });

  it("keeps the first copy of a repeated PubMed ID and lists the rest as duplicates", () => {
    const text = `PMID- 70000004
TI  - First copy

PMID- 70000004
TI  - Second copy
`;
    const plan = planPubmedImport(text);
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].title).toBe("First copy");
    expect(plan.duplicates).toEqual(["70000004"]);
  });

  it("refuses a file with more than 500 records to save", () => {
    const text = Array.from({ length: 501 }, (_, i) => `PMID- ${71000000 + i}\nTI  - Title ${i}\n`).join("\n");
    const plan = planPubmedImport(text);
    expect(plan.error).toMatch(/holds up to 500/);
  });

  it("accepts exactly 500 records", () => {
    const text = Array.from({ length: 500 }, (_, i) => `PMID- ${72000000 + i}\nTI  - Title ${i}\n`).join("\n");
    expect(planPubmedImport(text).error).toBeNull();
  });

  it("says so when the file has no PubMed records at all", () => {
    expect(planPubmedImport("hello\n").error).toMatch(/No PubMed records were found/);
  });
});
