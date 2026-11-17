import { describe, expect, it } from "vitest";
import {
  buildHistory,
  currentDecision,
  hasFilters,
  outcomeLabel,
  parseFilters,
  type HistoryEvent,
  type HistoryProposal,
} from "@/lib/decisions";

// Tests for the decision search filters and the record history (ADR-0019).

const BATCH = "83e65416-8f94-4617-9847-0fd7d42e022e";
const USER = "00000000-0000-0000-0000-00000000000b";

describe("parseFilters", () => {
  it("reads every filter from the address", () => {
    expect(
      parseFilters({ q: " smith ", batch: BATCH, outcome: "exclude", reviewer: USER, reason: "R-TOPIC-OUT" }),
    ).toEqual({ query: "smith", batchId: BATCH, outcome: "exclude", reviewerId: USER, reasonCode: "R-TOPIC-OUT" });
  });

  it("accepts undecided as an outcome", () => {
    expect(parseFilters({ outcome: "undecided" }).outcome).toBe("undecided");
  });

  it("drops values that are empty or not valid", () => {
    expect(
      parseFilters({ q: "   ", batch: "not-a-uuid", outcome: "maybe", reviewer: "1", reason: "drop table" }),
    ).toEqual({ query: null, batchId: null, outcome: null, reviewerId: null, reasonCode: null });
  });

  it("uses the first value when a filter is repeated, and caps the search text", () => {
    expect(parseFilters({ outcome: ["include", "exclude"] }).outcome).toBe("include");
    expect(parseFilters({ q: "x".repeat(500) }).query).toHaveLength(200);
  });

  it("says whether any filter is set", () => {
    expect(hasFilters(parseFilters({}))).toBe(false);
    expect(hasFilters(parseFilters({ outcome: "include" }))).toBe(true);
  });
});

describe("outcomeLabel", () => {
  it("labels each outcome, and a missing one as undecided", () => {
    expect(outcomeLabel("unsure")).toBe("Unsure");
    expect(outcomeLabel("send_to_clinician")).toBe("Send to clinician");
    expect(outcomeLabel(null)).toBe("Undecided");
  });
});

function event(overrides: Partial<HistoryEvent> & Pick<HistoryEvent, "id" | "recorded_at">): HistoryEvent {
  return {
    kind: "human_decision",
    outcome: "include",
    reason_code: "R-OK",
    free_text: "Text.",
    actor_id: USER,
    corrects_event_id: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<HistoryProposal> & Pick<HistoryProposal, "id" | "created_at">): HistoryProposal {
  return {
    model_id: "anthropic/claude-haiku-5.5",
    status: "proposed",
    outcome: "exclude",
    reason_code: "R-OUT",
    rationale: "Off topic.",
    ...overrides,
  };
}

describe("buildHistory", () => {
  // Times as the database sends them, with different numbers of decimal places.
  const haiku = proposal({ id: "p1", created_at: "2026-11-17T20:41:08.5+00:00" });
  const sonnet = proposal({
    id: "p2",
    model_id: "anthropic/claude-sonnet-5.5",
    outcome: "include",
    reason_code: "R-OK",
    created_at: "2026-11-17T20:41:09+00:00",
  });
  const unreadable = proposal({
    id: "p3",
    status: "invalid",
    outcome: null,
    reason_code: null,
    rationale: null,
    created_at: "2026-11-17T20:41:09.25+00:00",
  });
  const decision = event({ id: "e1", recorded_at: "2026-11-17T21:00:00.123456+00:00" });
  const correction = event({
    id: "e2",
    kind: "correction",
    outcome: "exclude",
    reason_code: "R-OUT",
    corrects_event_id: "e1",
    recorded_at: "2026-11-17T22:00:00+00:00",
  });

  it("puts proposals and events in the order they happened", () => {
    const history = buildHistory([correction, decision], [sonnet, unreadable, haiku]);
    expect(history.map((item) => (item.type === "proposal" ? item.proposal.id : item.event.id))).toEqual([
      "p1",
      "p2",
      "p3",
      "e1",
      "e2",
    ]);
  });

  it("compares a decision with each readable proposal made before it", () => {
    const history = buildHistory([decision], [haiku, sonnet, unreadable]);
    const item = history.find((entry) => entry.type === "event");
    expect(item?.type === "event" && item.comparisons).toEqual([
      { model_id: "anthropic/claude-haiku-5.5", outcome: "exclude", reason_code: "R-OUT", agrees: false },
      { model_id: "anthropic/claude-sonnet-5.5", outcome: "include", reason_code: "R-OK", agrees: true },
    ]);
  });

  it("ignores proposals made after the decision", () => {
    const later = proposal({ id: "p4", created_at: "2026-11-18T09:00:00+00:00" });
    const history = buildHistory([decision], [later]);
    const item = history.find((entry) => entry.type === "event");
    expect(item?.type === "event" && item.comparisons).toEqual([]);
  });

  it("links a correction to the event it corrects, and does not compare it with proposals", () => {
    const history = buildHistory([decision, correction], [haiku]);
    const item = history.at(-1);
    expect(item?.type === "event" && item.corrects?.id).toBe("e1");
    expect(item?.type === "event" && item.comparisons).toEqual([]);
  });

  it("puts a proposal before an event made at the same moment", () => {
    const sameTime = proposal({ id: "p5", created_at: "2026-11-17T21:00:00.123456+00:00" });
    const history = buildHistory([decision], [sameTime]);
    expect(history.map((item) => item.type)).toEqual(["proposal", "event"]);
  });
});

describe("currentDecision", () => {
  it("is the latest decision or correction, ignoring other kinds of event", () => {
    const decision = event({ id: "e1", recorded_at: "2026-11-17T21:00:00+00:00" });
    const correction = event({ id: "e2", kind: "correction", corrects_event_id: "e1", recorded_at: "2026-11-17T22:00:00.5+00:00" });
    const query = event({ id: "e3", kind: "query", outcome: null, reason_code: null, recorded_at: "2026-11-17T23:00:00+00:00" });
    expect(currentDecision([correction, query, decision])?.id).toBe("e2");
  });

  it("is null when nobody has decided", () => {
    expect(currentDecision([])).toBeNull();
  });
});
