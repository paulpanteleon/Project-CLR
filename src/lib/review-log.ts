// Shapes and messages for the read-only review log and its share links (US-13, ADR-0020). The
// database returns the log and each record's detail as JSON; these types describe it.

import type { HistoryEvent, HistoryProposal } from "@/lib/decisions";

// A share token is 32 random bytes in base64url: 43 characters.
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const EXPIRY_DAYS = [1, 7, 30] as const;

export type ShareInfo = { expires_at: string; named: boolean } | null;

export type ReviewLogRecord = {
  pmid: string;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  outcome: string | null;
  reason_code: string | null;
  reason_label: string | null;
  supporting_text: string | null;
  decided_by: string | null;
  decided_at: string | null;
  corrections: number;
  proposals: { model_id: string; status: string; outcome: string | null; reason_code: string | null }[];
};

export type ReviewLog = {
  result: "ok";
  share: ShareInfo;
  batch: { id: string; name: string; source_label: string; status: string; created_at: string };
  criteria_version: {
    review_name: string;
    version_number: number;
    status: string;
    approved_at: string | null;
    reasons: { code: string; label: string }[];
  } | null;
  records: ReviewLogRecord[];
};

export type DetailEvent = HistoryEvent & { actor_email: string | null; criteria_version_id: string | null };

export type DetailProposal = HistoryProposal & {
  criteria_version_id: string;
  prompt_version: string;
  settings: unknown;
  raw_output: string;
  upstream_provider: string;
  route_tag: string;
  zdr_enforced: boolean;
  data_region_reported: string | null;
  generation_id: string;
  actor_id: string;
  actor_email: string | null;
};

export type CriteriaVersionDetail = {
  id: string;
  review_name: string;
  version_number: number;
  status: string;
  review_topic: string;
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  design: string;
  dates: string;
  approved_at: string | null;
  reasons: { code: string; label: string }[];
};

export type RecordDetail = {
  result: "ok";
  share: ShareInfo;
  batch: { id: string; name: string; source_label: string; status: string; criteria_version_id: string | null };
  record: {
    pmid: string;
    doi: string | null;
    title: string;
    abstract: string | null;
    authors: string | null;
    journal: string | null;
    year: number | null;
  };
  file: { file_name: string; uploaded_at: string } | null;
  events: DetailEvent[];
  proposals: DetailProposal[];
  criteria_version: CriteriaVersionDetail | null;
};

export type Refusal = { result: Exclude<string, "ok">; expires_at: string | null };

// What a person sees when a log or record can't be opened. UC2: an expired link is refused, and
// the person is pointed to a new link from the batch owner.
export const REFUSAL_MESSAGES: Record<string, string> = {
  denied: "You are not a member of this batch. Ask a batch owner to share its review log with you.",
  not_found: "This link does not open a review log. Check that the whole link was copied.",
  expired: "This link has expired. Ask the batch owner for a new link.",
  revoked: "This link was withdrawn by the batch owner. Ask them for a new link if you still need access.",
  wrong_person: "This link was shared with someone else. Ask the batch owner for a link in your name.",
  no_role: "Your account has no role yet, so it can't open shared review logs. Ask an admin to assign one.",
};

export function refusalMessage(result: string) {
  return REFUSAL_MESSAGES[result] ?? "This review log can't be opened right now. Try again.";
}

export function isOk<T extends { result: string }>(value: T | Refusal | null): value is T & { result: "ok" } {
  return value?.result === "ok";
}
