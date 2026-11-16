// Turns a batch's screening decisions into a table, then into CSV or an Excel workbook (ADR-0017).
// Nothing here reads the database or the network. The .xlsx writer covers only what a plain table
// needs: one sheet, text and number cells, a bold header row that stays in view.

export type ExportRow = {
  pmid: string;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
  abstract: string | null;
  outcome: string | null;
  reason_code: string | null;
  reason_label: string | null;
  supporting_text: string | null;
  decided_by: string | null;
  decided_at: string | null;
  corrections: number | null;
  criteria_version: string | null;
};

export type Cell = string | number | null;

// "Unsure" is the agreed word for the third outcome (open questions, 2026-11-03).
const OUTCOME_LABELS: Record<string, string> = {
  include: "Include",
  exclude: "Exclude",
  unsure: "Unsure",
  send_to_clinician: "Send to clinician",
};

export const HEADERS = [
  "PMID",
  "Title",
  "Authors",
  "Journal",
  "Year",
  "DOI",
  "Outcome",
  "Reason code",
  "Reason",
  "Supporting text",
  "Decided by",
  "Decided at (UTC)",
  "Corrections",
  "Criteria version",
  "Abstract",
];

// UTC, to the minute, so a spreadsheet does not shift it into another time zone.
export function utcStamp(iso: string | null): string | null {
  if (!iso) return null;
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function toTable(rows: ExportRow[]): Cell[][] {
  return [
    HEADERS,
    ...rows.map((row) => [
      row.pmid,
      row.title,
      row.authors,
      row.journal,
      row.year,
      row.doi,
      row.outcome ? (OUTCOME_LABELS[row.outcome] ?? row.outcome) : "Undecided",
      row.reason_code,
      row.reason_label,
      row.supporting_text,
      row.decided_by,
      utcStamp(row.decided_at),
      row.outcome ? (row.corrections ?? 0) : null,
      row.criteria_version,
      row.abstract,
    ]),
  ];
}

// --- CSV ---

// A cell that starts with one of these could run as a formula when the file is opened in a
// spreadsheet. A leading apostrophe makes it plain text (OWASP CSV injection guidance).
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// UTF-8 with a byte order mark, so Excel reads accented characters correctly. Lines end in CRLF.
export function toCsv(table: Cell[][]): string {
  return `﻿${table.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// --- Excel (.xlsx) ---

const EXCEL_CELL_LIMIT = 32_767;

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Escapes XML and drops characters XML does not allow.
function xmlText(text: string): string {
  return text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetXml(table: Cell[][]): string {
  const rows = table.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === "") return "";
      const ref = `${columnName(c)}${r + 1}`;
      const style = r === 0 ? ' s="1"' : "";
      if (typeof cell === "number") return `<c r="${ref}"${style}><v>${cell}</v></c>`;
      const text = xmlText(cell.slice(0, EXCEL_CELL_LIMIT));
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    });
    return `<row r="${r + 1}">${cells.join("")}</row>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetData>${rows.join("")}</sheetData>` +
    "</worksheet>"
  );
}

const PARTS_BEFORE_SHEET: [string, string][] = [
  [
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>",
  ],
  [
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
  ],
  [
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Decisions" sheetId="1" r:id="rId1"/></sheets>' +
      "</workbook>",
  ],
  [
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  ],
  [
    "xl/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>",
  ],
];

export function toXlsx(table: Cell[][]): Uint8Array {
  return zip([...PARTS_BEFORE_SHEET, ["xl/worksheets/sheet1.xml", sheetXml(table)]]);
}

// --- A zip file with stored (uncompressed) entries, which is all an .xlsx package needs ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 1 January 1980, the earliest date a zip entry can hold. A fixed date keeps the output the same
// for the same input.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(files: [string, string][]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// A file name made from the batch name and today's date, safe for any operating system.
export function exportFileName(batchName: string, extension: "csv" | "xlsx", now = new Date()): string {
  const slug = batchName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${slug || "batch"}-decisions-${now.toISOString().slice(0, 10)}.${extension}`;
}
