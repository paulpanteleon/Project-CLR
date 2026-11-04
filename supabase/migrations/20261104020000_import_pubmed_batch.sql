-- Project CLR: import a PubMed export into a new batch in one step (US-01, ADR-0010).
-- Depends on 20261104000000_core_schema.sql and 20261104010000_records.sql.

-- Import summary counts, stored with the file (the file is append-only, so they are fixed at import).
alter table public.source_snapshots
  add column rejected_count integer not null default 0 check (rejected_count >= 0),
  add column duplicate_count integer not null default 0 check (duplicate_count >= 0);

-- Creates the batch, its file, and its records in one transaction. Any failure rolls
-- everything back, so no file is left without records (ADR-0010).
-- Runs with the caller's rights (security invoker), so row-level security applies:
-- the caller must be a reviewer or owner, and the batch's creator becomes its member.
-- The app checks the records before calling this. The database checks them again.
create function public.import_pubmed_batch(
  p_batch_name text,
  p_source_label text,
  p_file_name text,
  p_file_text text,
  p_checksum text,
  p_records jsonb,
  p_rejected_count integer,
  p_duplicate_count integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_snapshot_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'The records must be a list';
  end if;

  if jsonb_array_length(p_records) > 500 then
    raise exception 'A batch can hold up to 500 records. Split the export and import each part.'
      using errcode = 'check_violation';
  end if;

  insert into public.batches (id, name, source_label)
  values (v_batch_id, p_batch_name, p_source_label);

  insert into public.source_snapshots
    (id, batch_id, file_name, file_text, checksum, rejected_count, duplicate_count)
  values
    (v_snapshot_id, v_batch_id, p_file_name, p_file_text, p_checksum, p_rejected_count, p_duplicate_count);

  insert into public.records
    (batch_id, source_snapshot_id, pmid, doi, title, abstract, authors, journal, year)
  select
    v_batch_id, v_snapshot_id, r.pmid, r.doi, r.title, r.abstract, r.authors, r.journal, r.year
  from jsonb_to_recordset(p_records) as r(
    pmid text, doi text, title text, abstract text, authors text, journal text, year integer
  );

  return v_batch_id;
end;
$$;

revoke all on function public.import_pubmed_batch(text, text, text, text, text, jsonb, integer, integer) from public;
grant execute on function public.import_pubmed_batch(text, text, text, text, text, jsonb, integer, integer) to authenticated;
