-- Project CLR: screening criteria versions and their reasons (US-02, US-12, FR-DR-02, FR-DR-06).
-- A criteria version is the written rule set for one review. A medical writer drafts it and a
-- clinical affairs lead approves it. The drafter cannot approve (US-12). Once approved, its
-- text and reasons never change. A change is a new version (FR-DR-06). Locking happens once a
-- decision uses the version: lock_criteria_version is ready for that step. See ADR-0013.

-- Versions of the criteria for one review, with the PICO-style fields and the review topic.
create table public.criteria_versions (
  id uuid primary key,
  review_name text not null check (length(trim(review_name)) > 0),
  version_number integer not null check (version_number >= 1),
  review_topic text not null check (length(trim(review_topic)) > 0),
  population text not null check (length(trim(population)) > 0),
  intervention text not null check (length(trim(intervention)) > 0),
  comparator text not null check (length(trim(comparator)) > 0),
  outcomes text not null check (length(trim(outcomes)) > 0),
  design text not null check (length(trim(design)) > 0),
  dates text not null check (length(trim(dates)) > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'locked')),
  drafted_by uuid not null default auth.uid() references auth.users (id),
  drafted_at timestamptz not null default now(),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  constraint criteria_version_number_unique unique (review_name, version_number),
  constraint criteria_approval_complete check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status <> 'draft' and approved_by is not null and approved_at is not null)
  ),
  constraint criteria_drafter_cannot_approve check (approved_by is null or approved_by <> drafted_by)
);

-- The fixed reason list for a version (FR-DR-02). Each reason has a code and a label.
create table public.criteria_reasons (
  criteria_version_id uuid not null references public.criteria_versions (id) on delete restrict,
  code text not null check (code ~ '^[A-Z][A-Z0-9-]*$'),
  label text not null check (length(trim(label)) > 0),
  primary key (criteria_version_id, code)
);

-- Content never changes, and the status only moves draft -> approved -> locked.
-- The approval fields never change once the version is approved.
-- Versions are never deleted. Applies to every role, including the table owner.
create function public.guard_criteria_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Criteria versions cannot be deleted' using errcode = 'insufficient_privilege';
  end if;

  if (new.review_name, new.version_number, new.review_topic, new.population, new.intervention,
      new.comparator, new.outcomes, new.design, new.dates, new.drafted_by, new.drafted_at)
     is distinct from
     (old.review_name, old.version_number, old.review_topic, old.population, old.intervention,
      old.comparator, old.outcomes, old.design, old.dates, old.drafted_by, old.drafted_at) then
    raise exception 'Criteria version % is locked: its text cannot change', old.id
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

create trigger criteria_versions_guard
  before update or delete on public.criteria_versions
  for each row execute function public.guard_criteria_versions();

-- Reasons can be added only while the version is a draft, and never changed or removed.
create function public.guard_criteria_reasons()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Criteria reasons cannot be changed or deleted' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.criteria_versions where id = new.criteria_version_id;
  if v_status <> 'draft' then
    raise exception 'Criteria version is no longer a draft: reasons cannot be added'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger criteria_reasons_guard
  before insert or update or delete on public.criteria_reasons
  for each row execute function public.guard_criteria_reasons();

-- Returns the signed-in user's user type, or null. Used by row-level security below.
create function public.current_user_type()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.user_type from public.user_roles ur where ur.user_id = auth.uid();
$$;

alter table public.criteria_versions enable row level security;
alter table public.criteria_reasons enable row level security;

-- Signed-in users with a role see approved and locked versions. A draft is seen only by its
-- drafter and by clinical affairs leads, who approve it.
create policy criteria_versions_read on public.criteria_versions
  for select to authenticated
  using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid())
    and (
      status <> 'draft'
      or drafted_by = auth.uid()
      or public.current_user_type() = 'clinical_affairs_lead'
    )
  );

-- Reasons are visible exactly when their version is visible (the subquery applies the rule above).
create policy criteria_reasons_read on public.criteria_reasons
  for select to authenticated
  using (exists (select 1 from public.criteria_versions cv where cv.id = criteria_version_id));

-- Nothing is written directly. Changes go through the functions below.
revoke all on public.criteria_versions, public.criteria_reasons from anon, authenticated;
grant select on public.criteria_versions, public.criteria_reasons to authenticated;

-- Drafts a new version of a review's criteria, with its reasons. Only a medical writer who is
-- not read-only may draft. The app chooses the id. Returns 'ok' or 'denied'. Every attempt is audited.
create function public.create_criteria_version(
  p_id uuid,
  p_review_name text,
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
  v_number integer;
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = v_actor and user_type = 'medical_writer' and permission_level <> 'read_only'
  ) then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'criteria.draft', p_review_name, false);
    return 'denied';
  end if;

  if jsonb_array_length(coalesce(p_reasons, '[]'::jsonb)) = 0 then
    raise exception 'A criteria version needs at least one reason' using errcode = 'check_violation';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_number
  from public.criteria_versions
  where review_name = p_review_name;

  insert into public.criteria_versions (
    id, review_name, version_number, review_topic, population, intervention,
    comparator, outcomes, design, dates
  )
  values (
    p_id, p_review_name, v_number, p_review_topic, p_population, p_intervention,
    p_comparator, p_outcomes, p_design, p_dates
  );

  insert into public.criteria_reasons (criteria_version_id, code, label)
  select p_id, r.code, r.label
  from jsonb_to_recordset(p_reasons) as r (code text, label text);

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'criteria.draft', p_id::text, true);

  return 'ok';
end;
$$;

-- Approves a draft. Returns 'ok', 'not_found', 'own_draft' (the drafter cannot approve, US-12),
-- 'denied' (caller is not a clinical affairs lead), or 'not_draft'. Every attempt is audited.
create function public.approve_criteria_version(p_id uuid)
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
  elsif v_row.drafted_by = v_actor then
    v_result := 'own_draft';
  elsif not exists (
    select 1 from public.user_roles
    where user_id = v_actor and user_type = 'clinical_affairs_lead' and permission_level <> 'read_only'
  ) then
    v_result := 'denied';
  elsif v_row.status <> 'draft' then
    v_result := 'not_draft';
  else
    update public.criteria_versions
    set status = 'approved', approved_by = v_actor, approved_at = now()
    where id = p_id;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'criteria.approve', p_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- Locks an approved version, so it can no longer be used for new work. Returns 'ok',
-- 'not_found', 'denied' (caller is not a clinical affairs lead), 'not_approved' (still a draft),
-- or 'already_locked'. The decision step will call this when the first decision uses a version.
create function public.lock_criteria_version(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_result text := 'ok';
begin
  select status into v_status from public.criteria_versions where id = p_id;

  if v_status is null then
    v_result := 'not_found';
  elsif not exists (
    select 1 from public.user_roles
    where user_id = v_actor and user_type = 'clinical_affairs_lead' and permission_level <> 'read_only'
  ) then
    v_result := 'denied';
  elsif v_status = 'locked' then
    v_result := 'already_locked';
  elsif v_status = 'draft' then
    v_result := 'not_approved';
  else
    update public.criteria_versions set status = 'locked' where id = p_id;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'criteria.lock', p_id::text, v_result = 'ok');

  return v_result;
end;
$$;

revoke execute on function public.current_user_type() from public, anon;
revoke execute on function public.create_criteria_version(uuid, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.approve_criteria_version(uuid) from public, anon;
revoke execute on function public.lock_criteria_version(uuid) from public, anon;
grant execute on function public.current_user_type() to authenticated;
grant execute on function public.create_criteria_version(uuid, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.approve_criteria_version(uuid) to authenticated;
grant execute on function public.lock_criteria_version(uuid) to authenticated;
