// Shared pieces for finding decisions and showing a record's history (US-09, US-10, ADR-0019).

// "Unsure" is the agreed word for the third outcome (open questions, 2026-11-03).
export const OUTCOME_LABELS: Record<string, string> = {
  include: "Include",
  exclude: "Exclude",
  unsure: "Unsure",
  send_to_clinician: "Send to clinician",
};

export function outcomeLabel(outcome: string | null) {
  return outcome ? (OUTCOME_LABELS[outcome] ?? outcome) : "Undecided";
}

export const UNDECIDED = "undecided";

export type DecisionFilters = {
  query: string | null;
  batchId: string | null;
  outcome: string | null;
  reviewerId: string | null;
  reasonCode: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_CODE = /^[A-Z][A-Z0-9-]*$/;
const MAX_QUERY_LENGTH = 200;

function single(value: string | string[] | undefined) {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

// Reads the filters from the page's address. A value that isn't valid is dropped rather than sent
// to the database, so a hand-edited address shows unfiltered results instead of an error.
export function parseFilters(params: Record<string, string | string[] | undefined>): DecisionFilters {
  const query = single(params.q);
  const batchId = single(params.batch);
  const outcome = single(params.outcome);
  const reviewerId = single(params.reviewer);
  const reasonCode = single(params.reason);
  return {
    query: query ? query.slice(0, MAX_QUERY_LENGTH) : null,
    batchId: batchId && UUID.test(batchId) ? batchId : null,
    outcome: outcome && (outcome === UNDECIDED || outcome in OUTCOME_LABELS) ? outcome : null,
    reviewerId: reviewerId && UUID.test(reviewerId) ? reviewerId : null,
    reasonCode: reasonCode && REASON_CODE.test(reasonCode) ? reasonCode : null,
  };
}

export function hasFilters(filters: DecisionFilters) {
  return Object.values(filters).some((value) => value !== null);
}

export type HistoryEvent = {
  id: string;
  kind: string;
  outcome: string | null;
  reason_code: string | null;
  free_text: string | null;
  actor_id: string;
  recorded_at: string;
  corrects_event_id: string | null;
};

export type HistoryProposal = {
  id: string;
  model_id: string;
  status: string;
  outcome: string | null;
  reason_code: string | null;
  rationale: string | null;
  created_at: string;
};

// How a human decision compares with an AI proposal made before it.
export type Comparison = { model_id: string; outcome: string | null; reason_code: string | null; agrees: boolean };

export type HistoryItem =
  | { type: "proposal"; at: string; proposal: HistoryProposal }
  | { type: "event"; at: string; event: HistoryEvent; corrects: HistoryEvent | null; comparisons: Comparison[] };

// The database sends times with a varying number of decimal places, so they are compared as dates,
// not as text.
function time(iso: string) {
  return Date.parse(iso);
}

// One record's history in the order it happened: AI proposals, decisions, corrections, and any
// other events. Each human decision lists how it compares with the AI proposals made before it,
// which is how an override shows (FR-DR-03). A correction points at the event it corrects.
export function buildHistory(events: HistoryEvent[], proposals: HistoryProposal[]): HistoryItem[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const items: HistoryItem[] = [
    ...proposals.map((proposal): HistoryItem => ({ type: "proposal", at: proposal.created_at, proposal })),
    ...events.map((event): HistoryItem => {
      const comparisons =
        event.kind === "human_decision"
          ? proposals
              .filter((proposal) => proposal.status === "proposed" && time(proposal.created_at) <= time(event.recorded_at))
              .map((proposal) => ({
                model_id: proposal.model_id,
                outcome: proposal.outcome,
                reason_code: proposal.reason_code,
                agrees: proposal.outcome === event.outcome,
              }))
          : [];
      const corrects = event.corrects_event_id ? (byId.get(event.corrects_event_id) ?? null) : null;
      return { type: "event", at: event.recorded_at, event, corrects, comparisons };
    }),
  ];
  // Proposals come before events made at the same moment.
  return items.sort((a, b) => time(a.at) - time(b.at) || (a.type === b.type ? 0 : a.type === "proposal" ? -1 : 1));
}

// The current outcome: the latest decision or correction (US-10).
export function currentDecision(events: HistoryEvent[]): HistoryEvent | null {
  const decisions = events.filter((event) => event.kind === "human_decision" || event.kind === "correction");
  return decisions.reduce<HistoryEvent | null>(
    (latest, event) => (latest === null || time(event.recorded_at) >= time(latest.recorded_at) ? event : latest),
    null,
  );
}
