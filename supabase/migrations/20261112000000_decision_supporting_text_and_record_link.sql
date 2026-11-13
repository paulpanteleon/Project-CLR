-- Project CLR: each decision needs supporting text from the record, and each decision is linked to
-- its record's study metadata (US-04, US-11, FR-DR-01, FR-DR-02, ADR-0014).
-- Depends on 20261104010000_records.sql and 20261111000000_screening_decisions.sql.

-- A decision or correction must carry supporting text, so the reason can be checked against the
-- source. NOT VALID, so earlier rows are not checked. New rows are.
alter table public.decision_events
  add constraint decision_supporting_text_required check (
    kind not in ('human_decision', 'correction') or length(trim(coalesce(free_text, ''))) > 0
  ) not valid;

-- Each decision points at its record in the same batch. The record's title, DOI, journal, year
-- and abstract are then the study metadata for the decision. A record cannot be deleted while a
-- decision points at it. NOT VALID, so earlier rows are not checked. New rows are.
alter table public.decision_events
  add constraint decision_record_in_batch
  foreign key (batch_id, record_pmid)
  references public.records (batch_id, pmid) on delete restrict
  not valid;

-- Records a human decision. As before, plus: the supporting text is required and is stored trimmed.
create or replace function public.record_screening_decision(
  p_batch_id uuid,
  p_record_pmid text,
  p_outcome text,
  p_reason_code text,
  p_free_text text
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
  v_result text := 'ok';
begin
  select * into v_batch from public.batches where id = p_batch_id;

  if v_batch.id is null then
    v_result := 'not_found';
  elsif v_perm is null or v_perm not in ('reviewer', 'owner') then
    v_result := 'denied';
  elsif v_batch.status <> 'open' then
    v_result := 'batch_closed';
  elsif v_batch.criteria_version_id is null then
    v_result := 'no_criteria';
  elsif not exists (
    select 1 from public.records where batch_id = p_batch_id and pmid = p_record_pmid
  ) then
    v_result := 'not_in_batch';
  end if;

  if v_result <> 'ok' then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'screening.decide', p_batch_id::text, false);
    return v_result;
  end if;

  if p_outcome not in ('include', 'exclude', 'unsure', 'send_to_clinician') then
    raise exception 'Choose include, exclude, maybe or send to clinician' using errcode = 'check_violation';
  end if;
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'Choose a reason from the criteria list' using errcode = 'check_violation';
  end if;
  if p_free_text is null or length(trim(p_free_text)) = 0 then
    raise exception 'Add the supporting text from the record' using errcode = 'check_violation';
  end if;

  insert into public.decision_events (
    batch_id, record_pmid, kind, outcome, reason_code, free_text, criteria_version_id, actor_id
  )
  values (
    p_batch_id, p_record_pmid, 'human_decision', p_outcome, trim(p_reason_code),
    trim(p_free_text), v_batch.criteria_version_id, v_actor
  );

  update public.criteria_versions
  set status = 'locked'
  where id = v_batch.criteria_version_id and status = 'approved';

  return 'ok';
end;
$$;
