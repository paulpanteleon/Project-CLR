-- Project CLR: admins assign roles and reset a lost authenticator (US-15, US-21).
-- Depends on 20261104000000_core_schema.sql. Decisions in ADR-0011 and ADR-0012.

-- A pending authenticator reset. Set by an admin. Cleared when the user verifies a new authenticator.
alter table public.user_roles
  add column reset_requested_at timestamptz,
  add column reset_requested_by uuid references auth.users (id) on delete restrict;

-- True when the signed-in user is an owner. Security definer so it can read user_roles
-- without row-level security checking itself in a loop.
create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and permission_level = 'owner'
  );
$$;

-- Owners read every role. Other users keep reading only their own row (user_roles_read_own).
create policy user_roles_read_owners on public.user_roles
  for select to authenticated
  using (public.is_owner());

-- Sets a user's type and permission level. Returns 'ok', 'denied' (caller is not an owner),
-- or 'last_owner' (the change would leave no owner). Every attempt is audited. A denied
-- attempt returns a result rather than raising an error, so the audit row is kept.
create function public.admin_set_role(
  p_user_id uuid,
  p_user_type text,
  p_permission_level text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result text := 'ok';
  v_owners_left integer;
begin
  if p_user_type not in ('medical_writer', 'clinician_reviewer', 'clinical_affairs_lead') then
    raise exception 'Unknown user type' using errcode = 'check_violation';
  end if;
  if p_permission_level not in ('read_only', 'reviewer', 'owner') then
    raise exception 'Unknown permission level' using errcode = 'check_violation';
  end if;

  if not public.is_owner() then
    v_result := 'denied';
  elsif p_permission_level <> 'owner' and exists (
    select 1 from public.user_roles where user_id = p_user_id and permission_level = 'owner'
  ) then
    select count(*) into v_owners_left from public.user_roles where permission_level = 'owner';
    if v_owners_left <= 1 then
      v_result := 'last_owner';
    end if;
  end if;

  if v_result = 'ok' then
    insert into public.user_roles (user_id, user_type, permission_level, assigned_by, assigned_at)
    values (p_user_id, p_user_type, p_permission_level, v_actor, now())
    on conflict (user_id) do update set
      user_type = excluded.user_type,
      permission_level = excluded.permission_level,
      assigned_by = excluded.assigned_by,
      assigned_at = excluded.assigned_at;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'admin.set_role', p_user_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- Marks a user for an authenticator reset at their next sign-in. Returns 'ok', 'denied',
-- or 'not_found' (the user has no role row). Audited either way.
create function public.admin_request_reset(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result text := 'ok';
begin
  if not public.is_owner() then
    v_result := 'denied';
  elsif not exists (select 1 from public.user_roles where user_id = p_user_id) then
    v_result := 'not_found';
  else
    update public.user_roles
    set reset_requested_at = now(), reset_requested_by = v_actor
    where user_id = p_user_id;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'admin.request_reset', p_user_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- Clears the caller's own reset mark. Called after the user verifies a new authenticator.
-- It can only clear the caller's own row, and clearing it grants nothing (ADR-0012).
create function public.complete_authenticator_reset()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_cleared integer;
begin
  update public.user_roles
  set reset_requested_at = null, reset_requested_by = null
  where user_id = v_actor and reset_requested_at is not null;
  get diagnostics v_cleared = row_count;

  -- Only audited when a reset was actually pending. Ordinary set-ups are not reset completions.
  if v_cleared > 0 then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_actor, 'mfa.reset_completed', 'mfa', true);
  end if;
end;
$$;

-- Only signed-in users can call these, and only through the functions above.
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.admin_set_role(uuid, text, text) from public, anon;
revoke execute on function public.admin_request_reset(uuid) from public, anon;
revoke execute on function public.complete_authenticator_reset() from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.admin_set_role(uuid, text, text) to authenticated;
grant execute on function public.admin_request_reset(uuid) to authenticated;
grant execute on function public.complete_authenticator_reset() to authenticated;
