-- Project CLR: AI first-pass proposals per record, with their full reproducibility set
-- (US-03, FR-DR-05, FR-DR-10, FR-DR-11, FR-DR-12, T-3). Decided in ADR-0015.
-- Depends on 20261104010000_records.sql, 20261111000000_screening_decisions.sql and
-- 20261112000000_decision_supporting_text_and_record_link.sql.

-- One row per model's proposal for one record. Proposals are append-only (ADR-0004). A proposal is
-- never a decision: a reviewer still records one (ADR-0014).
create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  record_pmid text not null,
  criteria_version_id uuid not null references public.criteria_versions (id) on delete restrict,
  prompt_version text not null check (length(trim(prompt_version)) > 0),
  model_id text not null check (length(trim(model_id)) > 0),
  settings jsonb not null,
  raw_output text not null,
  status text not null check (status in ('proposed', 'invalid')),
  outcome text check (outcome in ('include', 'exclude', 'unsure', 'send_to_clinician')),
  reason_code text,
  rationale text,
  upstream_provider text not null check (length(trim(upstream_provider)) > 0),
  -- The one US route the app pins every request to (ADR-0015). Any other value is refused.
  route_tag text not null check (route_tag = 'amazon-bedrock/us-east-1'),
  -- Zero data retention is required on every request (FR-DR-12).
  zdr_enforced boolean not null check (zdr_enforced),
  -- As OpenRouter reported it. Kept so the open question stays visible (R-2).
  data_region_reported text,
  generation_id text not null check (length(trim(generation_id)) > 0),
  actor_id uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  -- The record must be in the batch.
  constraint ai_proposals_record_in_batch foreign key (batch_id, record_pmid)
    references public.records (batch_id, pmid) on delete restrict,
  -- A reason must come from the criteria version the proposal used (FR-DR-02).
  constraint ai_proposals_reason_from_version foreign key (criteria_version_id, reason_code)
    references public.criteria_reasons (criteria_version_id, code) on delete restrict,
  -- A proposal has an outcome, a reason and a rationale. Invalid output has none, only its raw text.
  constraint ai_proposals_proposed_complete check (
    status <> 'proposed' or (outcome is not null and reason_code is not null and rationale is not null)
  ),
  constraint ai_proposals_invalid_has_no_outcome check (
    status <> 'invalid' or (outcome is null and reason_code is null and rationale is null)
  ),
  -- One proposal per record, model and prompt version. A new prompt version makes new rows.
  constraint ai_proposals_one_per_model unique (batch_id, record_pmid, model_id, prompt_version)
);

create trigger ai_proposals_append_only
  before update or delete on public.ai_proposals
  for each row execute function public.refuse_change_to_append_only_table();

alter table public.ai_proposals enable row level security;

-- Members read the proposals for their batch. Nobody writes them directly; the function below does.
create policy ai_proposals_read_member on public.ai_proposals
  for select to authenticated
  using (public.permission_on_batch(batch_id) is not null);

-- Stores one proposal. Only a reviewer or owner, only an open batch that is public, only with a
-- criteria version, only for a record in the batch, and only once per model and prompt version.
-- Returns 'ok', 'not_found', 'denied', 'batch_closed', 'confidential_not_allowed', 'no_criteria',
-- 'not_in_batch', or 'duplicate'. Every attempt is audited. A route other than the pinned one, or a
-- missing zero-retention flag, raises an error from the table's checks.
create function public.store_ai_proposal(
  p_batch_id uuid,
  p_record_pmid text,
  p_model_id text,
  p_prompt_version text,
  p_settings jsonb,
  p_raw_output text,
  p_status text,
  p_outcome text,
  p_reason_code text,
  p_rationale text,
  p_upstream_provider text,
  p_route_tag text,
  p_zdr_enforced boolean,
  p_data_region_reported text,
  p_generation_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_perm text := public.permission_on_batch(p_batch_id);
  v_batch public.batches%rowtype;
  v_criteria uuid;
  v_result text := 'ok';
begin
  select * into v_batch from public.batches where id = p_batch_id;
  v_criteria := v_batch.criteria_version_id;

  if v_batch.id is null then
    v_result := 'not_found';
  elsif v_perm is null or v_perm not in ('reviewer', 'owner') then
    v_result := 'denied';
  elsif v_batch.status <> 'open' then
    v_result := 'batch_closed';
  elsif v_batch.source_label <> 'public' then
    v_result := 'confidential_not_allowed';
  elsif v_criteria is null then
    v_result := 'no_criteria';
  elsif not exists (
    select 1 from public.records where batch_id = p_batch_id and pmid = p_record_pmid
  ) then
    v_result := 'not_in_batch';
  elsif exists (
    select 1 from public.ai_proposals
    where batch_id = p_batch_id and record_pmid = p_record_pmid
      and model_id = p_model_id and prompt_version = p_prompt_version
  ) then
    v_result := 'duplicate';
  end if;

  if v_result <> 'ok' then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'ai.store_proposal', p_batch_id::text, false);
    return v_result;
  end if;

  insert into public.ai_proposals (
    batch_id, record_pmid, criteria_version_id, prompt_version, model_id, settings, raw_output,
    status, outcome, reason_code, rationale, upstream_provider, route_tag, zdr_enforced,
    data_region_reported, generation_id, actor_id
  )
  values (
    p_batch_id, p_record_pmid, v_criteria, p_prompt_version, p_model_id, p_settings, p_raw_output,
    p_status, p_outcome, nullif(trim(coalesce(p_reason_code, '')), ''), p_rationale,
    p_upstream_provider, p_route_tag, p_zdr_enforced, p_data_region_reported, p_generation_id, v_actor
  );

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'ai.store_proposal', p_batch_id::text, true);

  return 'ok';
end;
$$;

revoke all on public.ai_proposals from public, anon, authenticated;
grant select on public.ai_proposals to authenticated;

revoke execute on function public.store_ai_proposal(uuid, text, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.store_ai_proposal(uuid, text, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text) to authenticated;
