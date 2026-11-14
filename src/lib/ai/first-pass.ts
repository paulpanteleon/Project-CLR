// The first pass prompt and the check on what the model returns (US-03, FR-DR-02, FR-DR-10, ADR-0015).
// Nothing here calls the network. Each reply is checked against the batch's criteria before it is
// stored. A reply that does not fit is stored as invalid, with its raw text, and never shown as a proposal.

export const PROMPT_VERSION = "first-pass-v1";

export const OUTCOMES = ["include", "exclude", "unsure", "send_to_clinician"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type CriteriaForPrompt = {
  reviewTopic: string;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  design: string;
  dates: string;
  reasons: { code: string; label: string }[];
};

export type RecordForPrompt = { pmid: string; title: string; abstract: string | null };

export type ParsedReply =
  | { status: "proposed"; outcome: Outcome; reasonCode: string; rationale: string }
  | { status: "invalid" };

export function buildMessages(criteria: CriteriaForPrompt, record: RecordForPrompt) {
  const reasons = criteria.reasons.map((reason) => `- ${reason.code}: ${reason.label}`).join("\n");
  const system = [
    "You screen one clinical study against a review's criteria for a medical writer.",
    "Use only the criteria and the record text below. Do not use outside knowledge.",
    "Reply with JSON only, no other text, in this form:",
    '{"outcome": "include" | "exclude" | "unsure" | "send_to_clinician", "reason_code": "<one code from the list>", "rationale": "<one or two sentences that quote the part of the record that supports the reason>"}',
    "Use \"unsure\" when the record does not settle the question. Use \"send_to_clinician\" when a clinician must judge it.",
    "",
    `Review topic: ${criteria.reviewTopic}`,
    `Population: ${criteria.population}`,
    `Intervention: ${criteria.intervention}`,
    `Comparator: ${criteria.comparator}`,
    `Outcomes: ${criteria.outcomes}`,
    `Study design: ${criteria.design}`,
    `Dates: ${criteria.dates}`,
    "",
    "Reason codes (choose exactly one):",
    reasons,
  ].join("\n");

  const user = [
    `PMID: ${record.pmid}`,
    `Title: ${record.title}`,
    `Abstract: ${record.abstract?.trim() ? record.abstract : "(no abstract available)"}`,
  ].join("\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

// Reads the model's reply. Accepts JSON, optionally inside a code fence. Anything else is invalid.
export function parseReply(raw: string, reasonCodes: readonly string[]): ParsedReply {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { status: "invalid" };
  }
  if (typeof value !== "object" || value === null) return { status: "invalid" };

  const { outcome, reason_code: reasonCode, rationale } = value as Record<string, unknown>;
  if (typeof outcome !== "string" || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return { status: "invalid" };
  }
  if (typeof reasonCode !== "string" || !reasonCodes.includes(reasonCode)) {
    return { status: "invalid" };
  }
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    return { status: "invalid" };
  }
  return { status: "proposed", outcome: outcome as Outcome, reasonCode, rationale: rationale.trim() };
}
