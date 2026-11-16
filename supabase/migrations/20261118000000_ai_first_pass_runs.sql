-- Project CLR: run the AI first pass on a whole batch in the background (US-03, P-1). Decided in
-- ADR-0018. Depends on 20261113000000_ai_first_pass_proposals.sql and 20261116000000_batch_membership.sql.
--
-- A signed-in reviewer starts a run. The app makes a random key for it and sends the database only
-- its SHA-256 hash. The background steps have no sign-in: they call the functions below with the
-- run's id and key, and can act only for that run, only while it is running, and only until it
-- expires. Proposals are recorded as made by the person who started the run.

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  model_id text not null check (length(trim(model_id)) > 0),
  prompt_version text not null check (length(trim(prompt_version)) > 0),
  started_by uuid not null references auth.users (id),
  -- Hex SHA-256 of the run's key. Cleared when the run ends, so the key stops working.
  key_hash text check (key_hash is null or key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'finished', 'failed')),
  total integer not null check (total >= 0),
  proposed integer not null default 0,
  unreadable integer not null default 0,
  failed integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  finished_at timestamptz,
  constraint ai_runs_key_while_running check (status = 'running' or key_hash is null)
);

-- One running run per batch, model and prompt version.
create unique index ai_runs_one_running
  on public.ai_runs (batch_id, model_id, prompt_version)
  where status = 'running';

alter table public.ai_runs enable row level security;

-- Members see the runs on their batches, so the screen can show progress. Nobody writes directly.
create policy ai_runs_read_member on public.ai_runs
  for select to authenticated
  using (public.permission_on_batch(batch_id) is not null);

revoke all on public.ai_runs from public, anon, authenticated;
grant select (
  id, batch_id, model_id, prompt_version, started_by, status, total, proposed, unreadable, failed,
  last_error, started_at, expires_at, finished_at
) on public.ai_runs to authenticated;

-- The run, if the key matches and the run is still running and not expired. Otherwise nothing.
create function public.ai_run_for_key(p_run_id uuid, p_key text)
returns public.ai_runs
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.ai_runs r
  where r.id = p_run_id
    and r.status = 'running'
    and r.expires_at > now()
    and r.key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
$$;

-- The starter's permission level on the batch now, or null if they are no longer a member.
create function public.ai_run_starter_permission(p_run public.ai_runs)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.permission_level
  from public.batch_members bm
  join public.user_roles ur on ur.user_id = bm.user_id
  where bm.batch_id = p_run.batch_id and bm.user_id = p_run.started_by;
$$;

-- Starts a run. Only a reviewer or owner on an open, public batch with a criteria version, and only
-- one running run per batch, model and prompt version. Returns the result and, when 'ok', the run id.
-- Results: 'ok', 'not_found', 'denied', 'batch_closed', 'confidential_not_allowed', 'no_criteria',
-- 'already_running', 'nothing_to_do'. Every attempt is audited.
create function public.start_ai_run(
  p_batch_id uuid,
  p_model_id text,
  p_prompt_version text,
  p_key_hash text
)
returns table (result text, run_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_perm text := public.permission_on_batch(p_batch_id);
  v_batch public.batches%rowtype;
  v_total integer;
  v_result text := 'ok';
  v_run uuid;
begin
  select * into v_batch from public.batches where id = p_batch_id;

  -- Runs left running past their expiry are closed first, so they do not block a new one.
  update public.ai_runs
  set status = 'failed', key_hash = null, finished_at = now(), last_error = 'Expired before it finished.'
  where batch_id = p_batch_id and status = 'running' and expires_at <= now();

  select count(*)::integer into v_total
  from public.records r
  where r.batch_id = p_batch_id
    and not exists (
      select 1 from public.ai_proposals p
      where p.batch_id = r.batch_id and p.record_pmid = r.pmid
        and p.model_id = p_model_id and p.prompt_version = p_prompt_version
    );

  if v_batch.id is null then
    v_result := 'not_found';
  elsif v_perm is null or v_perm not in ('reviewer', 'owner') then
    v_result := 'denied';
  elsif v_batch.status <> 'open' then
    v_result := 'batch_closed';
  elsif v_batch.source_label <> 'public' then
    v_result := 'confidential_not_allowed';
  elsif v_batch.criteria_version_id is null then
    v_result := 'no_criteria';
  elsif exists (
    select 1 from public.ai_runs
    where batch_id = p_batch_id and model_id = p_model_id and prompt_version = p_prompt_version
      and status = 'running'
  ) then
    v_result := 'already_running';
  elsif v_total = 0 then
    v_result := 'nothing_to_do';
  else
    insert into public.ai_runs (batch_id, model_id, prompt_version, started_by, key_hash, total)
    values (p_batch_id, p_model_id, p_prompt_version, v_actor, lower(p_key_hash), v_total)
    returning id into v_run;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_actor, 'ai.start_run', p_batch_id::text, v_result = 'ok');

  return query select v_result, v_run;
end;
$$;

-- The records in the run's batch that have no proposal yet for the run's model and prompt version.
-- Empty when the key does not match or the run is not running.
create function public.ai_run_pending_records(p_run_id uuid, p_key text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select r.pmid
  from public.ai_run_for_key(p_run_id, p_key) run
  join public.records r on r.batch_id = run.batch_id
  where not exists (
    select 1 from public.ai_proposals p
    where p.batch_id = r.batch_id and p.record_pmid = r.pmid
      and p.model_id = run.model_id and p.prompt_version = run.prompt_version
  )
  order by r.pmid;
$$;

-- What a step needs to ask the model about one record: the batch's criteria and the record's title
-- and abstract. Null when the key does not match, the run is not running, or the record is not in
-- the batch.
create function public.ai_run_work_item(p_run_id uuid, p_key text, p_pmid text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'criteria', jsonb_build_object(
      'reviewTopic', cv.review_topic,
      'population', cv.population,
      'intervention', cv.intervention,
      'comparator', cv.comparator,
      'outcomes', cv.outcomes,
      'design', cv.design,
      'dates', cv.dates,
      'reasons', (
        select coalesce(jsonb_agg(jsonb_build_object('code', cr.code, 'label', cr.label) order by cr.code), '[]'::jsonb)
        from public.criteria_reasons cr where cr.criteria_version_id = cv.id
      )
    ),
    'record', jsonb_build_object('pmid', r.pmid, 'title', r.title, 'abstract', r.abstract)
  )
  from public.ai_run_for_key(p_run_id, p_key) run
  join public.batches b on b.id = run.batch_id
  join public.criteria_versions cv on cv.id = b.criteria_version_id
  join public.records r on r.batch_id = b.id and r.pmid = p_pmid;
$$;

-- Stores one proposal for the run, as the person who started it. The same rules as
-- store_ai_proposal apply, checked again now: the starter must still be a reviewer or owner on the
-- batch, and the batch must still be open, public and have a criteria version.
-- Returns 'ok', 'invalid_key', 'denied', 'batch_closed', 'confidential_not_allowed', 'no_criteria',
-- 'not_in_batch', or 'duplicate'. A route other than the pinned one, or no zero retention, raises an
-- error from the table's checks.
create function public.store_ai_run_proposal(
  p_run_id uuid,
  p_key text,
  p_record_pmid text,
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
  v_run public.ai_runs;
  v_batch public.batches%rowtype;
  v_perm text;
  v_result text := 'ok';
begin
  select * into v_run from public.ai_run_for_key(p_run_id, p_key);
  if v_run.id is null then
    return 'invalid_key';
  end if;

  select * into v_batch from public.batches where id = v_run.batch_id;
  v_perm := public.ai_run_starter_permission(v_run);

  if v_perm is null or v_perm not in ('reviewer', 'owner') then
    v_result := 'denied';
  elsif v_batch.status <> 'open' then
    v_result := 'batch_closed';
  elsif v_batch.source_label <> 'public' then
    v_result := 'confidential_not_allowed';
  elsif v_batch.criteria_version_id is null then
    v_result := 'no_criteria';
  elsif not exists (
    select 1 from public.records where batch_id = v_batch.id and pmid = p_record_pmid
  ) then
    v_result := 'not_in_batch';
  elsif exists (
    select 1 from public.ai_proposals
    where batch_id = v_batch.id and record_pmid = p_record_pmid
      and model_id = v_run.model_id and prompt_version = v_run.prompt_version
  ) then
    v_result := 'duplicate';
  end if;

  if v_result <> 'ok' then
    insert into public.audit_events (actor_id, action, target, allowed)
    values (v_run.started_by, 'ai.store_proposal', v_batch.id::text, false);
    return v_result;
  end if;

  insert into public.ai_proposals (
    batch_id, record_pmid, criteria_version_id, prompt_version, model_id, settings, raw_output,
    status, outcome, reason_code, rationale, upstream_provider, route_tag, zdr_enforced,
    data_region_reported, generation_id, actor_id
  )
  values (
    v_batch.id, p_record_pmid, v_batch.criteria_version_id, v_run.prompt_version, v_run.model_id,
    p_settings, p_raw_output, p_status, p_outcome, nullif(trim(coalesce(p_reason_code, '')), ''),
    p_rationale, p_upstream_provider, p_route_tag, p_zdr_enforced, p_data_region_reported,
    p_generation_id, v_run.started_by
  );

  update public.ai_runs
  set proposed = proposed + (p_status = 'proposed')::integer,
      unreadable = unreadable + (p_status = 'invalid')::integer
  where id = v_run.id;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (v_run.started_by, 'ai.store_proposal', v_batch.id::text, true);

  return 'ok';
end;
$$;

-- Counts a record the run could not propose for after its retries, and keeps the last error.
-- Returns 'ok' or 'invalid_key'.
create function public.record_ai_run_failure(p_run_id uuid, p_key text, p_message text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select id from public.ai_run_for_key(p_run_id, p_key)) is null then
    return 'invalid_key';
  end if;
  update public.ai_runs
  set failed = failed + 1, last_error = left(coalesce(p_message, ''), 500)
  where id = p_run_id;
  return 'ok';
end;
$$;

-- Ends the run and clears its key, so the key stops working. 'finished' when it ran to the end,
-- 'failed' when it stopped early. Returns 'ok' or 'invalid_key'.
create function public.finish_ai_run(p_run_id uuid, p_key text, p_failed boolean, p_message text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select id from public.ai_run_for_key(p_run_id, p_key)) is null then
    return 'invalid_key';
  end if;
  update public.ai_runs
  set status = case when p_failed then 'failed' else 'finished' end,
      key_hash = null,
      finished_at = now(),
      last_error = case when p_failed then left(coalesce(p_message, ''), 500) else last_error end
  where id = p_run_id;
  return 'ok';
end;
$$;

-- The key functions are called by background steps that have no sign-in, so the anon role may call
-- them. Without the run's key they do nothing.
revoke execute on function public.ai_run_for_key(uuid, text) from public, anon, authenticated;
revoke execute on function public.ai_run_starter_permission(public.ai_runs) from public, anon, authenticated;
revoke execute on function public.start_ai_run(uuid, text, text, text) from public, anon;
revoke execute on function public.ai_run_pending_records(uuid, text) from public;
revoke execute on function public.ai_run_work_item(uuid, text, text) from public;
revoke execute on function public.store_ai_run_proposal(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text) from public;
revoke execute on function public.record_ai_run_failure(uuid, text, text) from public;
revoke execute on function public.finish_ai_run(uuid, text, boolean, text) from public;

grant execute on function public.start_ai_run(uuid, text, text, text) to authenticated;
grant execute on function public.ai_run_pending_records(uuid, text) to anon, authenticated;
grant execute on function public.ai_run_work_item(uuid, text, text) to anon, authenticated;
grant execute on function public.store_ai_run_proposal(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text) to anon, authenticated;
grant execute on function public.record_ai_run_failure(uuid, text, text) to anon, authenticated;
grant execute on function public.finish_ai_run(uuid, text, boolean, text) to anon, authenticated;
