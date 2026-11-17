-- Project CLR: find decisions across the batches a person belongs to, and show who made them
-- (US-09, US-10, UC2, S10, S11, FR-DR-07). Decided in ADR-0019.
-- Depends on 20261111000000_screening_decisions.sql, 20261112000000_decision_supporting_text_and_record_link.sql
-- and 20261113000000_ai_first_pass_proposals.sql.

-- One row per record in the caller's batches, with its current outcome (the latest decision or
-- correction) and the reviewer's email. Records without a decision come back with empty decision
-- fields. Every filter is optional:
--   p_query        a PubMed ID (exact), or text found in the title or authors (any case)
--   p_batch_id     one batch
--   p_outcome      'include', 'exclude', 'unsure', 'send_to_clinician', or 'undecided'
--   p_reviewer_id  the person who made the current decision
--   p_reason_code  the current decision's reason code
-- Newest decisions come first, then undecided records. At most p_limit rows (1 to 500).
create function public.find_decisions(
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
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

-- The people who made a current or past decision in the caller's batches, with their email, for the
-- reviewer filter.
create function public.decision_reviewers()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.actor_id, u.email::text
  from public.decision_events e
  join auth.users u on u.id = e.actor_id
  where e.kind in ('human_decision', 'correction')
    and public.permission_on_batch(e.batch_id) is not null
  order by 2;
$$;

-- Everyone who appears in a batch's history (members, reviewers, and whoever ran the AI first pass),
-- with their email. Someone removed from the batch still shows, so old decisions keep their name.
-- Rows are returned only to members of that batch.
create function public.batch_people(p_batch_id uuid)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select people.user_id, u.email::text
  from (
    select bm.user_id from public.batch_members bm where bm.batch_id = p_batch_id
    union
    select e.actor_id from public.decision_events e where e.batch_id = p_batch_id
    union
    select p.actor_id from public.ai_proposals p where p.batch_id = p_batch_id
  ) people
  join auth.users u on u.id = people.user_id
  where public.permission_on_batch(p_batch_id) is not null
  order by 2;
$$;

revoke execute on function public.find_decisions(text, uuid, text, uuid, text, integer) from public, anon;
revoke execute on function public.decision_reviewers() from public, anon;
revoke execute on function public.batch_people(uuid) from public, anon;
grant execute on function public.find_decisions(text, uuid, text, uuid, text, integer) to authenticated;
grant execute on function public.decision_reviewers() to authenticated;
grant execute on function public.batch_people(uuid) to authenticated;
