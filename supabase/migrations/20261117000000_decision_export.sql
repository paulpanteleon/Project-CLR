-- Project CLR: export a batch's screening decisions (scope, Epic 1; functional requirements line 17
-- and 21). Decided in ADR-0017.
-- Depends on 20261111000000_screening_decisions.sql and 20261112000000_decision_supporting_text_and_record_link.sql.

-- One row per record in the batch, with its current outcome (the latest decision or correction) and
-- the reviewer's email. Records without a decision come back with empty decision fields. Only a
-- member of the batch gets rows. Every call is audited as an export, allowed or not.
create function public.batch_decision_export(p_batch_id uuid)
returns table (
  pmid text,
  title text,
  authors text,
  journal text,
  year integer,
  doi text,
  abstract text,
  outcome text,
  reason_code text,
  reason_label text,
  supporting_text text,
  decided_by text,
  decided_at timestamptz,
  corrections integer,
  criteria_version text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean := public.permission_on_batch(p_batch_id) is not null;
begin
  insert into public.audit_events (actor_id, action, target, allowed)
  values (auth.uid(), 'batch.export_decisions', p_batch_id::text, v_allowed);

  if not v_allowed then
    return;
  end if;

  return query
  select
    r.pmid,
    r.title,
    r.authors,
    r.journal,
    r.year,
    r.doi,
    r.abstract,
    c.outcome,
    c.reason_code,
    cr.label,
    c.free_text,
    u.email::text,
    c.recorded_at,
    (
      select count(*)::integer from public.decision_events e
      where e.batch_id = r.batch_id and e.record_pmid = r.pmid and e.kind = 'correction'
    ),
    case when cv.id is null then null else cv.review_name || ', version ' || cv.version_number end
  from public.records r
  left join public.current_screening_outcomes c on c.batch_id = r.batch_id and c.record_pmid = r.pmid
  left join public.criteria_reasons cr on cr.criteria_version_id = c.criteria_version_id and cr.code = c.reason_code
  left join public.criteria_versions cv on cv.id = c.criteria_version_id
  left join auth.users u on u.id = c.actor_id
  where r.batch_id = p_batch_id
  order by r.pmid;
end;
$$;

revoke execute on function public.batch_decision_export(uuid) from public, anon;
grant execute on function public.batch_decision_export(uuid) to authenticated;
