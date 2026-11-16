import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { HEADERS, crc32, exportFileName, toCsv, toTable, toXlsx, type ExportRow } from "@/lib/export/decisions";

// Tests for turning decisions into CSV and Excel (ADR-0017).

const DECIDED: ExportRow = {
  pmid: "31492632",
  title: "2019 guidelines for VTE in cancer",
  authors: "Farge D, Frere C",
  journal: "Lancet Oncol",
  year: 2019,
  doi: "10.1016/S1470-2045(19)30336-5",
  abstract: "Venous thromboembolism is common.",
  outcome: "exclude",
  reason_code: "R-TOPIC-OUT",
  reason_label: "Does not describe AI applied to clinical literature review.",
  supporting_text: 'A clinical guideline, "not AI".',
  decided_by: "writer@example.com",
  decided_at: "2026-11-11T00:07:33.123Z",
  corrections: 1,
  criteria_version: "AI in clinical literature review, version 1",
};

const UNDECIDED: ExportRow = {
  ...DECIDED,
  pmid: "37188504",
  title: "=HYPERLINK(\"http://example.com\")",
  outcome: null,
  reason_code: null,
  reason_label: null,
  supporting_text: null,
  decided_by: null,
  decided_at: null,
  corrections: 0,
  criteria_version: null,
};

describe("toTable", () => {
  it("starts with the header row and gives one row per record", () => {
    const table = toTable([DECIDED, UNDECIDED]);
    expect(table[0]).toEqual(HEADERS);
    expect(table).toHaveLength(3);
  });

  it("labels the outcome, writes the time in UTC to the minute, and counts corrections", () => {
    const [, row] = toTable([DECIDED]);
    expect(row[HEADERS.indexOf("Outcome")]).toBe("Exclude");
    expect(row[HEADERS.indexOf("Decided at (UTC)")]).toBe("2026-11-11 00:07 UTC");
    expect(row[HEADERS.indexOf("Corrections")]).toBe(1);
    expect(row[HEADERS.indexOf("Year")]).toBe(2019);
  });

  it("lists a record without a decision as Undecided, with empty decision fields", () => {
    const [, row] = toTable([UNDECIDED]);
    expect(row[HEADERS.indexOf("Outcome")]).toBe("Undecided");
    expect(row[HEADERS.indexOf("Reason code")]).toBeNull();
    expect(row[HEADERS.indexOf("Corrections")]).toBeNull();
  });

  it("uses Unsure, the agreed word, for the third outcome", () => {
    const [, row] = toTable([{ ...DECIDED, outcome: "unsure" }]);
    expect(row[HEADERS.indexOf("Outcome")]).toBe("Unsure");
  });
});

describe("toCsv", () => {
  const csv = toCsv(toTable([DECIDED, UNDECIDED]));

  it("starts with a byte order mark and ends lines with CRLF", () => {
    expect(csv.startsWith("﻿PMID,Title,")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(4);
  });

  it("quotes cells with commas or quotes, doubling the quotes", () => {
    expect(csv).toContain('"A clinical guideline, ""not AI""."');
    expect(csv).toContain('"Farge D, Frere C"');
  });

  it("stops a cell that starts like a formula from running as one", () => {
    expect(csv).toContain(`"'=HYPERLINK(""http://example.com"")"`);
  });
});

// Reads the entries of a stored (uncompressed) zip from its central directory.
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: { name: string; crc: number; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    entries.push({ name, crc, data: bytes.subarray(dataStart, dataStart + size) });
    at += 46 + nameLength;
  }
  return entries;
}

describe("toXlsx", () => {
  const entries = readZip(toXlsx(toTable([DECIDED, UNDECIDED])));
  const sheet = new TextDecoder().decode(entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!.data);

  it("packages the parts Excel needs", () => {
    expect(entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("stores a checksum for each part that matches Node's own CRC-32", () => {
    for (const entry of entries) {
      expect(entry.crc).toBe(nodeCrc32(entry.data));
    }
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes text as escaped inline strings and numbers as numbers", () => {
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">PMID</t></is></c>');
    expect(sheet).toContain("A clinical guideline, &quot;not AI&quot;.");
    expect(sheet).toContain('<c r="E2"><v>2019</v></c>');
  });

  it("keeps formula-like text as text, since inline strings never run", () => {
    expect(sheet).toContain("=HYPERLINK(&quot;http://example.com&quot;)");
    expect(sheet).not.toContain("<f>");
  });

  it("drops characters XML does not allow", () => {
    const [entry] = readZip(toXlsx(toTable([{ ...DECIDED, title: "Bad\u0001char" }]))).filter((e) =>
      e.name.endsWith("sheet1.xml"),
    );
    expect(new TextDecoder().decode(entry.data)).toContain("Badchar");
  });
});

describe("exportFileName", () => {
  it("makes a safe name from the batch name and date", () => {
    expect(exportFileName("pubmed-usingaiinr set / v2", "csv", new Date("2026-11-16T12:00:00Z"))).toBe(
      "pubmed-usingaiinr-set-v2-decisions-2026-11-16.csv",
    );
    expect(exportFileName("???", "xlsx", new Date("2026-11-16T12:00:00Z"))).toBe("batch-decisions-2026-11-16.xlsx");
  });
});
