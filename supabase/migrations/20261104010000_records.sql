-- Project CLR: source files and PubMed records.
-- One copy of each record per batch, and both tables are append-only (decided 2026-11-04).
-- Depends on 20261104000000_core_schema.sql (batches, permission_on_batch, refuse_change_to_append_only_table).

-- The PubMed export file exactly as it was uploaded to a batch (US-01). Kept so the import
-- can be checked later, and so backups cover it (decided 2026-10-28).
create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  file_name text not null check (length(trim(file_name)) > 0),
  file_text text not null check (length(file_text) > 0),
  -- SHA-256 of file_text, as 64 lowercase hex characters. Set by the app at upload.
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz not null default now(),
  -- Lets records require their snapshot to be in the same batch.
  constraint source_snapshots_batch_key unique (batch_id, id)
);

-- One PubMed record as it was screened in one batch (US-01, FR-DR-01).
-- The same PubMed ID can appear in more than one batch, with one row in each.
create table public.records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  source_snapshot_id uuid not null,
  pmid text not null check (pmid ~ '^[0-9]+$'),
  doi text check (doi is null or length(trim(doi)) > 0),
  title text not null check (length(trim(title)) > 0),
  -- Abstract may be missing. Those records are flagged and screened from the title (UC1).
  abstract text check (abstract is null or length(trim(abstract)) > 0),
  authors text,
  journal text,
  year integer check (year is null or year between 1800 and 2200),
  -- Kept with the record, so a decision can show the full reference (FR-DR, decision record).
  created_at timestamptz not null default now(),
  -- One copy of each PubMed ID per batch. Duplicates in an import are flagged and
  -- the reviewer keeps one before the import is saved (UC1, alternate flows).
  constraint records_one_per_batch unique (batch_id, pmid),
  -- A record's file must be in the same batch.
  constraint records_snapshot_same_batch foreign key (batch_id, source_snapshot_id)
    references public.source_snapshots (batch_id, id) on delete restrict
);

-- Append-only. Updates and deletes raise an error for every role (T-2).
create trigger source_snapshots_append_only
  before update or delete on public.source_snapshots
  for each row execute function public.refuse_change_to_append_only_table();

create trigger records_append_only
  before update or delete on public.records
  for each row execute function public.refuse_change_to_append_only_table();

alter table public.source_snapshots enable row level security;
alter table public.records enable row level security;

-- Members can read a batch's files and records (US-14). Only reviewers and owners can add them,
-- and only as themselves for files (matches the decision rules).
create policy source_snapshots_read_member on public.source_snapshots
  for select to authenticated
  using (public.permission_on_batch(batch_id) is not null);

create policy source_snapshots_insert_reviewer on public.source_snapshots
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.permission_on_batch(batch_id) in ('reviewer', 'owner')
  );

create policy records_read_member on public.records
  for select to authenticated
  using (public.permission_on_batch(batch_id) is not null);

create policy records_insert_reviewer on public.records
  for insert to authenticated
  with check (public.permission_on_batch(batch_id) in ('reviewer', 'owner'));

-- Privileges. Authenticated users may read and add. Update and delete are never granted,
-- in addition to the trigger. Start from nothing, because new tables can get default grants.
revoke all on public.source_snapshots, public.records from anon, authenticated;
grant select, insert on public.source_snapshots to authenticated;
grant select, insert on public.records to authenticated;
