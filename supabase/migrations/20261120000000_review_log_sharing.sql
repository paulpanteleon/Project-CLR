-- Project CLR: a read-only review log per batch, shared through expiring links, with every view
-- audited (US-13, UC2, S14, functional requirements lines 17 and 26). Decided in ADR-0020.
-- Depends on 20261116000000_batch_membership.sql and 20261119000000_decision_search.sql.

-- One row per share link. The app makes a random token and the database keeps only its SHA-256
-- hash, so a stored row cannot be turned back into a working link. A link names one recipient by
-- email, or none (an open link for anyone signed in with a role). Either way it needs sign-in, and
-- it stops working when it expires or is revoked.
create table public.review_log_shares (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_email text check (
    recipient_email is null or (recipient_email = lower(trim(recipient_email)) and recipient_email like '%@%')
  ),
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  -- Links last at most 30 days.
  constraint share_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint share_revoke_complete check ((revoked_at is null) = (revoked_by is null))
);

-- Shares are never deleted, and only revocation may change, once.
create function public.guard_review_log_shares()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'review_log_shares rows cannot be deleted';
  end if;
  if old.revoked_at is not null
     or new.id <> old.id
     or new.batch_id <> old.batch_id
     or new.token_hash <> old.token_hash
     or new.recipient_email is distinct from old.recipient_email
     or new.expires_at <> old.expires_at
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'a review log share can only be revoked, once';
  end if;
  return new;
end;
$$;

create trigger review_log_shares_guard
  before update or delete on public.review_log_shares
  for each row execute function public.guard_review_log_shares();

-- Nobody reads or writes the table directly. The functions below do, and none returns the hash.
alter table public.review_log_shares enable row level security;
revoke all on public.review_log_shares from anon, authenticated;

-- Whether the caller may see a batch's log, and through which share. With no token, the caller must
-- be a member (a membership and a role). With a token, the link must exist, be current, belong to
-- the batch when one is given, and, if it names someone, name the caller. The caller needs a role.
-- Returns 'ok', 'denied', 'not_found', 'revoked', 'expired', 'no_role' or 'wrong_person'.
create function public.review_log_access(p_batch_id uuid, p_token_hash text)
returns table (result text, batch_id uuid, share_id uuid, expires_at timestamptz, named boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_share public.review_log_shares%rowtype;
  v_email text;
begin
  if p_token_hash is null then
    if p_batch_id is not null and public.permission_on_batch(p_batch_id) is not null then
      return query select 'ok', p_batch_id, null::uuid, null::timestamptz, null::boolean;
    else
      return query select 'denied', p_batch_id, null::uuid, null::timestamptz, null::boolean;
    end if;
    return;
  end if;

  select * into v_share from public.review_log_shares s where s.token_hash = p_token_hash;
  if not found or (p_batch_id is not null and v_share.batch_id <> p_batch_id) then
    return query select 'not_found', p_batch_id, null::uuid, null::timestamptz, null::boolean;
    return;
  end if;
  if v_share.revoked_at is not null then
    return query select 'revoked', v_share.batch_id, v_share.id, v_share.expires_at, v_share.recipient_email is not null;
    return;
  end if;
  if v_share.expires_at <= now() then
    return query select 'expired', v_share.batch_id, v_share.id, v_share.expires_at, v_share.recipient_email is not null;
    return;
  end if;
  if not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid()) then
    return query select 'no_role', v_share.batch_id, v_share.id, v_share.expires_at, v_share.recipient_email is not null;
    return;
  end if;
  if v_share.recipient_email is not null then
    select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
    if v_email is distinct from v_share.recipient_email then
      return query select 'wrong_person', v_share.batch_id, v_share.id, v_share.expires_at, true;
      return;
    end if;
  end if;
  return query select 'ok', v_share.batch_id, v_share.id, v_share.expires_at, v_share.recipient_email is not null;
end;
$$;

-- What a view is audited against: the batch, plus the share when one was used.
create function public.review_log_audit_target(p_batch_id uuid, p_share_id uuid, p_detail text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_batch_id::text, 'unknown')
    || coalesce('/share/' || p_share_id::text, '')
    || coalesce('/' || p_detail, '');
$$;

-- Creates a share link for a batch. Only someone who can manage the batch. p_days is 1, 7 or 30.
-- A named link must name someone with an account and a role. Returns 'ok', 'not_found', 'denied',
-- 'invalid_expiry' or 'unknown_recipient', with the new share's id. Every attempt is audited.
create function public.create_review_log_share(
  p_batch_id uuid,
  p_token_hash text,
  p_recipient_email text,
  p_days integer
)
returns table (result text, share_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text;
  v_email text := nullif(lower(trim(p_recipient_email)), '');
  v_id uuid;
begin
  if not exists (select 1 from public.batches b where b.id = p_batch_id) then
    v_result := 'not_found';
  elsif not public.can_manage_batch(p_batch_id) then
    v_result := 'denied';
  elsif p_days is null or p_days not in (1, 7, 30) then
    v_result := 'invalid_expiry';
  elsif v_email is not null and not exists (
    select 1 from auth.users u join public.user_roles ur on ur.user_id = u.id where lower(u.email) = v_email
  ) then
    v_result := 'unknown_recipient';
  else
    insert into public.review_log_shares (batch_id, token_hash, recipient_email, expires_at, created_by)
    values (p_batch_id, p_token_hash, v_email, now() + make_interval(days => p_days), auth.uid())
    returning id into v_id;
    v_result := 'ok';
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (auth.uid(), 'review_log.share', public.review_log_audit_target(p_batch_id, v_id, null), v_result = 'ok');

  return query select v_result, v_id;
end;
$$;

-- Revokes a share link. Only someone who can manage its batch. Returns 'ok', 'not_found', 'denied'
-- or 'already_ended' (revoked or expired). Every attempt is audited.
create function public.revoke_review_log_share(p_share_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.review_log_shares%rowtype;
  v_result text;
begin
  select * into v_share from public.review_log_shares s where s.id = p_share_id;
  if not found then
    v_result := 'not_found';
  elsif not public.can_manage_batch(v_share.batch_id) then
    v_result := 'denied';
  elsif v_share.revoked_at is not null or v_share.expires_at <= now() then
    v_result := 'already_ended';
  else
    update public.review_log_shares s set revoked_at = now(), revoked_by = auth.uid() where s.id = p_share_id;
    v_result := 'ok';
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (
    auth.uid(),
    'review_log.revoke',
    public.review_log_audit_target(v_share.batch_id, p_share_id, null),
    v_result = 'ok'
  );
  return v_result;
end;
$$;

-- A batch's share links, newest first, for the people who can manage it. Never the hash. Counts how
-- often each link has been opened, from the audit history.
create function public.review_log_shares_for_batch(p_batch_id uuid)
returns table (
  id uuid,
  recipient_email text,
  status text,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz,
  revoked_at timestamptz,
  views integer,
  last_viewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.recipient_email,
    case when s.revoked_at is not null then 'revoked' when s.expires_at <= now() then 'expired' else 'active' end,
    s.expires_at,
    u.email::text,
    s.created_at,
    s.revoked_at,
    (
      select count(*)::integer from public.audit_events a
      where a.action in ('review_log.view', 'decision.view') and a.allowed
        and a.target like s.batch_id::text || '/share/' || s.id::text || '%'
    ),
    (
      select max(a.occurred_at) from public.audit_events a
      where a.action in ('review_log.view', 'decision.view') and a.allowed
        and a.target like s.batch_id::text || '/share/' || s.id::text || '%'
    )
  from public.review_log_shares s
  join auth.users u on u.id = s.created_by
  where s.batch_id = p_batch_id
    and public.can_manage_batch(p_batch_id)
  order by s.created_at desc;
$$;

-- The review log for a batch: the batch, its criteria version and reasons, and one entry per record
-- with its current outcome, reason, supporting text, reviewer, time, corrections and the AI
-- proposals' outcomes. Reached by a member (no token) or through a share link (token, and the batch
-- may be left out). Returns {"result": ...} only, unless the result is 'ok'. Every call is audited
-- as a view, allowed or not.
create function public.review_log(p_batch_id uuid default null, p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access record;
  v_log jsonb;
begin
  select * into v_access from public.review_log_access(p_batch_id, p_token_hash);

  insert into public.audit_events (actor_id, action, target, allowed)
  values (
    auth.uid(),
    'review_log.view',
    public.review_log_audit_target(v_access.batch_id, v_access.share_id, null),
    v_access.result = 'ok'
  );

  if v_access.result <> 'ok' then
    return jsonb_build_object('result', v_access.result, 'expires_at', v_access.expires_at);
  end if;

  select jsonb_build_object(
    'result', 'ok',
    'share', case when v_access.share_id is null then null
      else jsonb_build_object('expires_at', v_access.expires_at, 'named', v_access.named) end,
    'batch', jsonb_build_object(
      'id', b.id, 'name', b.name, 'source_label', b.source_label, 'status', b.status, 'created_at', b.created_at
    ),
    'criteria_version', (
      select jsonb_build_object(
        'review_name', cv.review_name, 'version_number', cv.version_number, 'status', cv.status,
        'approved_at', cv.approved_at,
        'reasons', coalesce((
          select jsonb_agg(jsonb_build_object('code', cr.code, 'label', cr.label) order by cr.code)
          from public.criteria_reasons cr where cr.criteria_version_id = cv.id
        ), '[]'::jsonb)
      )
      from public.criteria_versions cv where cv.id = b.criteria_version_id
    ),
    'records', coalesce((
      select jsonb_agg(entry order by entry ->> 'pmid')
      from (
        select jsonb_build_object(
          'pmid', r.pmid,
          'title', r.title,
          'authors', r.authors,
          'journal', r.journal,
          'year', r.year,
          'outcome', c.outcome,
          'reason_code', c.reason_code,
          'reason_label', cr.label,
          'supporting_text', c.free_text,
          'decided_by', u.email,
          'decided_at', c.recorded_at,
          'corrections', (
            select count(*) from public.decision_events e
            where e.batch_id = r.batch_id and e.record_pmid = r.pmid and e.kind = 'correction'
          ),
          'proposals', coalesce((
            select jsonb_agg(
              jsonb_build_object('model_id', p.model_id, 'status', p.status, 'outcome', p.outcome, 'reason_code', p.reason_code)
              order by p.created_at
            )
            from public.ai_proposals p where p.batch_id = r.batch_id and p.record_pmid = r.pmid
          ), '[]'::jsonb)
        ) as entry
        from public.records r
        left join public.current_screening_outcomes c on c.batch_id = r.batch_id and c.record_pmid = r.pmid
        left join public.criteria_reasons cr on cr.criteria_version_id = c.criteria_version_id and cr.code = c.reason_code
        left join auth.users u on u.id = c.actor_id
        where r.batch_id = b.id
      ) entries
    ), '[]'::jsonb)
  )
  into v_log
  from public.batches b
  where b.id = v_access.batch_id;

  return v_log;
end;
$$;

-- Everything about one record's decisions: the record as screened, its import file, every event and
-- AI proposal with the people's emails, and the criteria version it was decided under (or the
-- batch's, if undecided) with its reasons. Reached by a member or through a share link, like
-- review_log. Every call is audited as a view of the decision, allowed or not.
create function public.record_decision_detail(p_batch_id uuid, p_pmid text, p_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access record;
  v_record public.records%rowtype;
  v_version_id uuid;
begin
  select * into v_access from public.review_log_access(p_batch_id, p_token_hash);
  if v_access.result = 'ok' then
    select * into v_record from public.records r where r.batch_id = v_access.batch_id and r.pmid = p_pmid;
    if not found then
      v_access.result := 'not_found';
    end if;
  end if;

  insert into public.audit_events (actor_id, action, target, allowed)
  values (
    auth.uid(),
    'decision.view',
    public.review_log_audit_target(v_access.batch_id, v_access.share_id, 'record/' || coalesce(p_pmid, '')),
    v_access.result = 'ok'
  );

  if v_access.result <> 'ok' then
    return jsonb_build_object('result', v_access.result, 'expires_at', v_access.expires_at);
  end if;

  select coalesce(
    (
      select c.criteria_version_id from public.current_screening_outcomes c
      where c.batch_id = v_record.batch_id and c.record_pmid = v_record.pmid
    ),
    (select b.criteria_version_id from public.batches b where b.id = v_record.batch_id)
  ) into v_version_id;

  return (
    select jsonb_build_object(
      'result', 'ok',
      'share', case when v_access.share_id is null then null
        else jsonb_build_object('expires_at', v_access.expires_at, 'named', v_access.named) end,
      'batch', jsonb_build_object(
        'id', b.id, 'name', b.name, 'source_label', b.source_label, 'status', b.status,
        'criteria_version_id', b.criteria_version_id
      ),
      'record', jsonb_build_object(
        'pmid', v_record.pmid, 'doi', v_record.doi, 'title', v_record.title, 'abstract', v_record.abstract,
        'authors', v_record.authors, 'journal', v_record.journal, 'year', v_record.year
      ),
      'file', (
        select jsonb_build_object('file_name', f.file_name, 'uploaded_at', f.uploaded_at)
        from public.source_snapshots f where f.id = v_record.source_snapshot_id
      ),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'outcome', e.outcome, 'reason_code', e.reason_code, 'free_text', e.free_text,
          'actor_id', e.actor_id, 'actor_email', u.email, 'recorded_at', e.recorded_at,
          'corrects_event_id', e.corrects_event_id, 'criteria_version_id', e.criteria_version_id
        ) order by e.recorded_at, e.id)
        from public.decision_events e
        left join auth.users u on u.id = e.actor_id
        where e.batch_id = v_record.batch_id and e.record_pmid = v_record.pmid
      ), '[]'::jsonb),
      'proposals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'model_id', p.model_id, 'status', p.status, 'outcome', p.outcome,
          'reason_code', p.reason_code, 'rationale', p.rationale, 'created_at', p.created_at,
          'criteria_version_id', p.criteria_version_id, 'prompt_version', p.prompt_version, 'settings', p.settings,
          'raw_output', p.raw_output, 'upstream_provider', p.upstream_provider, 'route_tag', p.route_tag,
          'zdr_enforced', p.zdr_enforced, 'data_region_reported', p.data_region_reported,
          'generation_id', p.generation_id, 'actor_id', p.actor_id, 'actor_email', u.email
        ) order by p.created_at, p.id)
        from public.ai_proposals p
        left join auth.users u on u.id = p.actor_id
        where p.batch_id = v_record.batch_id and p.record_pmid = v_record.pmid
      ), '[]'::jsonb),
      'criteria_version', (
        select jsonb_build_object(
          'id', cv.id, 'review_name', cv.review_name, 'version_number', cv.version_number, 'status', cv.status,
          'review_topic', cv.review_topic, 'population', cv.population, 'intervention', cv.intervention,
          'comparator', cv.comparator, 'outcomes', cv.outcomes, 'design', cv.design, 'dates', cv.dates,
          'approved_at', cv.approved_at,
          'reasons', coalesce((
            select jsonb_agg(jsonb_build_object('code', cr.code, 'label', cr.label) order by cr.code)
            from public.criteria_reasons cr where cr.criteria_version_id = cv.id
          ), '[]'::jsonb)
        )
        from public.criteria_versions cv where cv.id = v_version_id
      )
    )
    from public.batches b
    where b.id = v_record.batch_id
  );
end;
$$;

-- find_decisions (ADR-0019) now records each search in the audit history, because search results
-- show decisions (functional requirements line 17). Same inputs and results as before.
create or replace function public.find_decisions(
  p_query text default null,
  p_batch_id uuid default null,
  p_outcome text default null,
  p_reviewer_id uuid default null,
  p_reason_code text default null,
  p_limit integer default 100
)
returns table (
  batch_id uuid,
  batch_name text,
  pmid text,
  title text,
  authors text,
  journal text,
  year integer,
  outcome text,
  reason_code text,
  reason_label text,
  decided_by_id uuid,
  decided_by text,
  decided_at timestamptz,
  corrections integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  insert into public.audit_events (actor_id, action, target, allowed)
  values (auth.uid(), 'decision.search', coalesce(p_batch_id::text, 'all batches'), true);

  return query
  with mine as (
    -- The batches the caller can open: a membership and a role, as permission_on_batch requires.
    select bm.batch_id
    from public.batch_members bm
    join public.user_roles ur on ur.user_id = bm.user_id
    where bm.user_id = auth.uid()
  ),
  search as (
    -- The text as typed, and the same text with LIKE's wildcards escaped.
    select
      nullif(trim(p_query), '') as exact,
      '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select
    r.batch_id,
    b.name,
    r.pmid,
    r.title,
    r.authors,
    r.journal,
    r.year,
    c.outcome,
    c.reason_code,
    cr.label,
    c.actor_id,
    u.email::text,
    c.recorded_at,
    (
      select count(*)::integer from public.decision_events e
      where e.batch_id = r.batch_id and e.record_pmid = r.pmid and e.kind = 'correction'
    )
  from public.records r
  join mine on mine.batch_id = r.batch_id
  join public.batches b on b.id = r.batch_id
  cross join search s
  left join public.current_screening_outcomes c on c.batch_id = r.batch_id and c.record_pmid = r.pmid
  left join public.criteria_reasons cr on cr.criteria_version_id = c.criteria_version_id and cr.code = c.reason_code
  left join auth.users u on u.id = c.actor_id
  where (p_batch_id is null or r.batch_id = p_batch_id)
    and (
      s.exact is null
      or r.pmid = s.exact
      or r.title ilike s.pattern
      or r.authors ilike s.pattern
    )
    and (
      p_outcome is null
      or (p_outcome = 'undecided' and c.event_id is null)
      or c.outcome = p_outcome
    )
    and (p_reviewer_id is null or c.actor_id = p_reviewer_id)
    and (p_reason_code is null or c.reason_code = p_reason_code)
  order by c.recorded_at desc nulls last, b.name, r.pmid
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke execute on function public.guard_review_log_shares() from public, anon, authenticated;
revoke execute on function public.review_log_access(uuid, text) from public, anon, authenticated;
revoke execute on function public.review_log_audit_target(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_review_log_share(uuid, text, text, integer) from public, anon;
revoke execute on function public.revoke_review_log_share(uuid) from public, anon;
revoke execute on function public.review_log_shares_for_batch(uuid) from public, anon;
revoke execute on function public.review_log(uuid, text) from public, anon;
revoke execute on function public.record_decision_detail(uuid, text, text) from public, anon;
grant execute on function public.create_review_log_share(uuid, text, text, integer) to authenticated;
grant execute on function public.revoke_review_log_share(uuid) to authenticated;
grant execute on function public.review_log_shares_for_batch(uuid) to authenticated;
grant execute on function public.review_log(uuid, text) to authenticated;
grant execute on function public.record_decision_detail(uuid, text, text) to authenticated;
