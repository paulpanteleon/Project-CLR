-- Project CLR: the drafter can edit a criteria draft until it is approved (US-02, ADR-0013).
-- Changes the guards so that the draft text and reasons may change while the status is draft.
-- The review name, version number, drafter and draft time never change. Approved text and
-- reasons never change. Adds update_criteria_draft.

-- The review, version number, drafter and draft time never change. The text may change only
-- while the version is a draft. The status moves only draft -> approved -> locked. The approval
-- fields never change once the version is approved. Versions are never deleted.
create or replace function public.guard_criteria_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Criteria versions cannot be deleted' using errcode = 'insufficient_privilege';
  end if;

  if (new.review_name, new.version_number, new.drafted_by, new.drafted_at)
     is distinct from
     (old.review_name, old.version_number, old.drafted_by, old.drafted_at) then
    raise exception 'Criteria version % cannot change its review, number or drafter', old.id
      using errcode = 'insufficient_privilege';
  end if;

  if old.status <> 'draft'
     and (new.review_topic, new.population, new.intervention, new.comparator,
          new.outcomes, new.design, new.dates)
         is distinct from
         (old.review_topic, old.population, old.intervention, old.comparator,
          old.outcomes, old.design, old.dates) then
    raise exception 'Criteria version % is no longer a draft: its text cannot change', old.id
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'approved')
           or (old.status = 'approved' and new.status = 'locked')) then
    raise exception 'Criteria version cannot move from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft'
     and (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'The approval of criteria version % cannot change', old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Reasons can be added, changed and removed only while the version is a draft.
create or replace function public.guard_criteria_reasons()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.criteria_versions
  where id = coalesce(new.criteria_version_id, old.criteria_version_id);

  if v_status is distinct from 'draft' then
    raise exception 'Criteria version is no longer a draft: its reasons cannot change'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Replaces the text and reasons of a draft. Only the drafter, while they are a medical writer
-- who is not read-only, and only while the version is a draft. Returns 'ok', 'not_found',
-- 'denied', or 'not_draft'. Every attempt is audited. The review name is not editable.
create function public.update_criteria_draft(
  p_id uuid,
  p_review_topic text,
  p_population text,
  p_intervention text,
  p_comparator text,
  p_outcomes text,
  p_design text,
  p_dates text,
  p_reasons jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.criteria_versions%rowtype;
  v_result text := 'ok';
begin
  select * into v_row from public.criteria_versions where id = p_id;

  if not found then
    v_result := 'not_found';
  elsif v_row.drafted_by <> v_actor or not exists (
    select 1 from public.user_roles
    where user_id = v_actor and user_type = 'medical_writer' and permission_level <> 'read_only'
  ) then
    v_result := 'denied';
  elsif v_row.status <> 'draft' then
    v_result := 'not_draft';
  end if;

  if v_result <> 'ok' then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'criteria.edit_draft', p_id::text, false);
    return v_result;
  end if;

  if jsonb_array_length(coalesce(p_reasons, '[]'::jsonb)) = 0 then
    raise exception 'A criteria version needs at least one reason' using errcode = 'check_violation';
  end if;

  update public.criteria_versions
  set review_topic = p_review_topic,
      population = p_population,
      intervention = p_intervention,
      comparator = p_comparator,
      outcomes = p_outcomes,
      design = p_design,
      dates = p_dates
  where id = p_id;

  delete from public.criteria_reasons where criteria_version_id = p_id;

  insert into public.criteria_reasons (criteria_version_id, code, label)
  select p_id, r.code, r.label
  from jsonb_to_recordset(p_reasons) as r (code text, label text);

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'criteria.edit_draft', p_id::text, true);

  return 'ok';
end;
$$;

revoke execute on function public.update_criteria_draft(uuid, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_criteria_draft(uuid, text, text, text, text, text, text, text, jsonb) to authenticated;
