import { describe, expect, it } from "vitest";
import { buildMessages, parseReply, type CriteriaForPrompt } from "@/lib/ai/first-pass";

// Tests for the first-pass prompt and the check on the model's reply (FR-DR-02, FR-DR-10, ADR-0015).

const CRITERIA: CriteriaForPrompt = {
  reviewTopic: "AI in clinical literature review",
  population: "Published studies of AI tools",
  intervention: "AI used to screen literature",
  comparator: "Manual screening",
  outcomes: "Accuracy or time saved",
  design: "Primary studies and reviews",
  dates: "2018 to 2026",
  reasons: [
    { code: "R-TOPIC-OK", label: "Describes AI applied to clinical literature review." },
    { code: "R-TOPIC-OUT", label: "Does not describe AI applied to clinical literature review." },
  ],
};
const CODES = CRITERIA.reasons.map((reason) => reason.code);

describe("buildMessages", () => {
  it("puts the criteria, the reason codes and the record in the prompt", () => {
    const [system, user] = buildMessages(CRITERIA, { pmid: "70000001", title: "A study", abstract: "Results." });
    expect(system.content).toContain("Review topic: AI in clinical literature review");
    expect(system.content).toContain("- R-TOPIC-OK: Describes AI applied");
    expect(user.content).toContain("PMID: 70000001");
    expect(user.content).toContain("Abstract: Results.");
  });

  it("asks for no confidence score, and says a record without an abstract is screened from its title", () => {
    const [system, user] = buildMessages(CRITERIA, { pmid: "70000002", title: "Title only", abstract: null });
    expect(system.content.toLowerCase()).not.toContain("confidence");
    expect(user.content).toContain("(no abstract available)");
  });
});

describe("parseReply", () => {
  it("accepts a JSON reply with an outcome, a listed reason and a rationale", () => {
    const reply = parseReply(
      '{"outcome":"include","reason_code":"R-TOPIC-OK","rationale":"The abstract describes AI screening."}',
      CODES,
    );
    expect(reply).toEqual({
      status: "proposed",
      outcome: "include",
      reasonCode: "R-TOPIC-OK",
      rationale: "The abstract describes AI screening.",
    });
  });

  it("accepts the same JSON inside a code fence", () => {
    const reply = parseReply(
      '```json\n{"outcome":"exclude","reason_code":"R-TOPIC-OUT","rationale":"Not about AI."}\n```',
      CODES,
    );
    expect(reply.status).toBe("proposed");
  });

  it("treats any outcome outside the four as unreadable", () => {
    expect(parseReply('{"outcome":"maybe","reason_code":"R-TOPIC-OK","rationale":"x"}', CODES)).toEqual({
      status: "invalid",
    });
  });

  it("treats a reason that is not in the criteria as unreadable", () => {
    expect(parseReply('{"outcome":"include","reason_code":"R-MADE-UP","rationale":"x"}', CODES)).toEqual({
      status: "invalid",
    });
  });

  it("treats a blank rationale as unreadable", () => {
    expect(parseReply('{"outcome":"include","reason_code":"R-TOPIC-OK","rationale":"   "}', CODES)).toEqual({
      status: "invalid",
    });
  });

  it("treats text that is not JSON, or a JSON array, as unreadable", () => {
    expect(parseReply("I think it should be included.", CODES)).toEqual({ status: "invalid" });
    expect(parseReply("[1, 2]", CODES)).toEqual({ status: "invalid" });
  });
});
