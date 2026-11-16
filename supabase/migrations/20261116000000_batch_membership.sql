-- Project CLR: add and remove people on a batch (US-14). Decided in ADR-0016.
-- Depends on 20261104000000_core_schema.sql and 20261105000000_admin_roles_and_reset.sql.

-- True for a member of the batch who created it or has the owner permission level.
create function public.can_manage_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.batches b
    join public.batch_members bm on bm.batch_id = b.id and bm.user_id = auth.uid()
    join public.user_roles ur on ur.user_id = auth.uid()
    where b.id = p_batch_id
      and (b.created_by = auth.uid() or ur.permission_level = 'owner')
  );
$$;

-- Adds a user, found by email, to a batch. Only someone who can manage the batch, and only a user
-- with a role. Returns 'ok', 'not_found', 'denied', 'unknown_user', or 'already_member'.
-- Every attempt is audited.
create function public.add_batch_member(p_batch_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_user uuid;
  v_result text := 'ok';
begin
  select u.id into v_user
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  where lower(u.email) = lower(trim(coalesce(p_email, '')));

  if not exists (select 1 from public.batches where id = p_batch_id) then
    v_result := 'not_found';
  elsif not public.can_manage_batch(p_batch_id) then
    v_result := 'denied';
  elsif v_user is null then
    v_result := 'unknown_user';
  elsif exists (select 1 from public.batch_members where batch_id = p_batch_id and user_id = v_user) then
    v_result := 'already_member';
  else
    insert into public.batch_members (batch_id, user_id) values (p_batch_id, v_user);
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'batch.add_member', p_batch_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- Removes a member from a batch. Only someone who can manage the batch, and never the creator.
-- Returns 'ok', 'not_found', 'denied', 'not_member', or 'creator'. Every attempt is audited.
-- The member's decisions and events stay, because events are append-only (ADR-0004).
create function public.remove_batch_member(p_batch_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_creator uuid;
  v_result text := 'ok';
begin
  select created_by into v_creator from public.batches where id = p_batch_id;

  if v_creator is null then
    v_result := 'not_found';
  elsif not public.can_manage_batch(p_batch_id) then
    v_result := 'denied';
  elsif not exists (select 1 from public.batch_members where batch_id = p_batch_id and user_id = p_user_id) then
    v_result := 'not_member';
  elsif p_user_id = v_creator then
    v_result := 'creator';
  else
    delete from public.batch_members where batch_id = p_batch_id and user_id = p_user_id;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'batch.remove_member', p_batch_id::text, v_result = 'ok');

  return v_result;
end;
$$;

-- The members of a batch, with their email, user type and permission level. Rows are returned only
-- to members of that batch. A member without a role shows with empty role fields.
create function public.batch_member_details(p_batch_id uuid)
returns table (
  user_id uuid,
  email text,
  user_type text,
  permission_level text,
  is_creator boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select bm.user_id, u.email::text, ur.user_type, ur.permission_level, bm.user_id = b.created_by
  from public.batch_members bm
  join public.batches b on b.id = bm.batch_id
  join auth.users u on u.id = bm.user_id
  left join public.user_roles ur on ur.user_id = bm.user_id
  where bm.batch_id = p_batch_id
    and exists (
      select 1 from public.batch_members me
      where me.batch_id = p_batch_id and me.user_id = auth.uid()
    )
  order by bm.user_id = b.created_by desc, u.email;
$$;

revoke execute on function public.can_manage_batch(uuid) from public, anon;
revoke execute on function public.add_batch_member(uuid, text) from public, anon;
revoke execute on function public.remove_batch_member(uuid, uuid) from public, anon;
revoke execute on function public.batch_member_details(uuid) from public, anon;
grant execute on function public.can_manage_batch(uuid) to authenticated;
grant execute on function public.add_batch_member(uuid, text) to authenticated;
grant execute on function public.remove_batch_member(uuid, uuid) to authenticated;
grant execute on function public.batch_member_details(uuid) to authenticated;
