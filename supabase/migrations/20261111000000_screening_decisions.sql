-- Project CLR: screening decisions bound to the batch's criteria version (US-02, US-04, US-05,
-- US-11, FR-DR-01, FR-DR-02, FR-DR-04, FR-DR-06). Decided in ADR-0014.
-- Depends on 20261104000000_core_schema.sql, 20261104010000_records.sql and
-- 20261109000000_criteria_versions.sql.

-- A batch screens against one approved criteria version. It is set before the first decision
-- and cannot change once a decision exists (set_batch_criteria).
alter table public.batches
  add column criteria_version_id uuid references public.criteria_versions (id) on delete restrict;

-- Decisions point at the criteria version they were made under, and at one reason from it.
-- The old free-text criteria_version column is kept only for the one earlier test row on dev.
-- New rows leave it empty.
alter table public.decision_events alter column criteria_version drop not null;
alter table public.decision_events
  add column criteria_version_id uuid references public.criteria_versions (id) on delete restrict;

-- A reason must come from the decision's own criteria version (FR-DR-02). With a null
-- version or reason the check is skipped, so queries and flags are not affected.
alter table public.decision_events
  add constraint decision_reason_from_version
  foreign key (criteria_version_id, reason_code)
  references public.criteria_reasons (criteria_version_id, code) on delete restrict;

-- New decisions and corrections must name their criteria version. NOT VALID, so the one
-- earlier test row is not checked.
alter table public.decision_events
  add constraint decision_version_required check (
    kind not in ('human_decision', 'correction') or criteria_version_id is not null
  ) not valid;

-- One correction per event. Two people cannot correct the same event at once.
create unique index decision_events_one_correction
  on public.decision_events (corrects_event_id)
  where corrects_event_id is not null;

-- The current outcome for each record: the latest human decision or correction (US-10, FR-DR-04).
-- security_invoker, so the rows a person can read are still limited by decision_events' rules.
create view public.current_screening_outcomes with (security_invoker = true) as
select distinct on (batch_id, record_pmid)
  batch_id,
  record_pmid,
  id as event_id,
  kind,
  outcome,
  reason_code,
  free_text,
  criteria_version_id,
  actor_id,
  recorded_at
from public.decision_events
where kind in ('human_decision', 'correction')
order by batch_id, record_pmid, recorded_at desc, id;

-- Sets the batch's criteria version. Only a reviewer or owner, only an open batch, only an
-- approved or locked version, and only before any decision exists. Returns 'ok', 'not_found',
-- 'denied', 'batch_closed', 'has_decisions', or 'not_approved'. Every attempt is audited.
create function public.set_batch_criteria(p_batch_id uuid, p_criteria_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_perm text := public.permission_on_batch(p_batch_id);
  v_batch public.batches%rowtype;
  v_status text;
  v_result text := 'ok';
begin
  select * into v_batch from public.batches where id = p_batch_id;
  select status into v_status from public.criteria_versions where id = p_criteria_version_id;

  if v_batch.id is null then
    v_result := 'not_found';
  elsif v_perm is null or v_perm not in ('reviewer', 'owner') then
    v_result := 'denied';
  elsif v_batch.status <> 'open' then
    v_result := 'batch_closed';
  elsif exists (
    select 1 from public.decision_events
    where batch_id = p_batch_id and kind in ('human_decision', 'correction')
  ) then
    v_result := 'has_decisions';
  elsif v_status is distinct from 'approved' and v_status is distinct from 'locked' then
    v_result := 'not_approved';
  else
    update public.batches set criteria_version_id = p_criteria_version_id where id = p_batch_id;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'batch.set_criteria', p_batch_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- Records a human decision on one record in a batch (US-04, US-05). The criteria version comes
-- from the batch, not from the caller. Using the version locks it (FR-DR-06). Returns 'ok',
-- 'not_found', 'denied', 'batch_closed', 'no_criteria', or 'not_in_batch'. A denied attempt is audited.
-- Raises an error when the outcome is not one of the four, or when no reason is given.
create function public.record_screening_decision(
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

  insert into public.decision_events (
    batch_id, record_pmid, kind, outcome, reason_code, free_text, criteria_version_id, actor_id
  )
  values (
    p_batch_id, p_record_pmid, 'human_decision', p_outcome, trim(p_reason_code),
    nullif(trim(coalesce(p_free_text, '')), ''), v_batch.criteria_version_id, v_actor
  );

  update public.criteria_versions
  set status = 'locked'
  where id = v_batch.criteria_version_id and status = 'approved';

  return 'ok';
end;
$$;

-- Corrects a decision by adding a new event that points at it (US-11, FR-DR-04). Only the latest
-- event for a record can be corrected, and a correction needs a reason in free text. Returns 'ok',
-- 'not_found', 'denied', 'batch_closed', 'no_criteria', or 'superseded'. A denied attempt is audited.
create function public.correct_screening_decision(
  p_event_id uuid,
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
  v_actor uuid;
  v_event public.decision_events%rowtype;
  v_batch public.batches%rowtype;
  v_perm text;
  v_result text := 'ok';
begin
  v_actor := auth.uid();
  select * into v_event from public.decision_events where id = p_event_id;

  if v_event.id is null or v_event.kind not in ('human_decision', 'correction') then
    v_result := 'not_found';
  else
    v_perm := public.permission_on_batch(v_event.batch_id);
    select * into v_batch from public.batches where id = v_event.batch_id;
    if v_perm is null or v_perm not in ('reviewer', 'owner') then
      v_result := 'denied';
    elsif v_batch.status <> 'open' then
      v_result := 'batch_closed';
    elsif v_batch.criteria_version_id is null then
      v_result := 'no_criteria';
    elsif exists (select 1 from public.decision_events where corrects_event_id = p_event_id) then
      v_result := 'superseded';
    end if;
  end if;

  if v_result <> 'ok' then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'screening.correct', p_event_id::text, false);
    return v_result;
  end if;

  if p_outcome not in ('include', 'exclude', 'unsure', 'send_to_clinician') then
    raise exception 'Choose include, exclude, maybe or send to clinician' using errcode = 'check_violation';
  end if;
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'Choose a reason from the criteria list' using errcode = 'check_violation';
  end if;
  if p_free_text is null or length(trim(p_free_text)) = 0 then
    raise exception 'A correction needs a reason' using errcode = 'check_violation';
  end if;

  insert into public.decision_events (
    batch_id, record_pmid, kind, outcome, reason_code, free_text,
    criteria_version_id, corrects_event_id, actor_id
  )
  values (
    v_event.batch_id, v_event.record_pmid, 'correction', p_outcome, trim(p_reason_code), trim(p_free_text),
    v_batch.criteria_version_id, p_event_id, v_actor
  );

  return 'ok';
end;
$$;

-- Row-level security is unchanged. The current outcomes view reads through the same rules.
grant select on public.current_screening_outcomes to authenticated;

revoke execute on function public.set_batch_criteria(uuid, uuid) from public, anon;
revoke execute on function public.record_screening_decision(uuid, text, text, text, text) from public, anon;
revoke execute on function public.correct_screening_decision(uuid, text, text, text) from public, anon;
grant execute on function public.set_batch_criteria(uuid, uuid) to authenticated;
grant execute on function public.record_screening_decision(uuid, text, text, text, text) to authenticated;
grant execute on function public.correct_screening_decision(uuid, text, text, text) to authenticated;
