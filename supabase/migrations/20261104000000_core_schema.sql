-- Project CLR: core schema for the first build.
-- Covers users and roles, batches and membership, append-only decision events,
-- and append-only audit events. Row-level security is on for every table.
-- Written to run on Supabase (auth.users and auth.uid() come from Supabase).
-- See docs/adr/0003 (Supabase client), 0004 (append-only events), and
-- docs/architecture/plan.md (tier 3).

-- User types and permission levels (US-15, S-2). Only an owner may change them.
create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  user_type text not null check (user_type in ('medical_writer', 'clinician_reviewer', 'clinical_affairs_lead')),
  permission_level text not null check (permission_level in ('read_only', 'reviewer', 'owner')),
  assigned_by uuid references auth.users (id),
  assigned_at timestamptz not null default now()
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  source_label text not null check (source_label in ('public', 'confidential')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

-- Who can see a batch (US-14). A user with no row here sees nothing in the batch.
create table public.batch_members (
  batch_id uuid not null references public.batches (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  primary key (batch_id, user_id)
);

-- Human decisions, overrides, corrections, queries, and their responses (FR-DR-04).
-- Rows are never updated or deleted. A correction points at the event it corrects.
create table public.decision_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete restrict,
  record_pmid text not null check (length(trim(record_pmid)) > 0),
  kind text not null check (kind in ('human_decision', 'override', 'correction', 'query', 'query_response')),
  outcome text check (outcome in ('include', 'exclude', 'unsure', 'send_to_clinician')),
  reason_code text,
  free_text text,
  criteria_version text not null check (length(trim(criteria_version)) > 0),
  corrects_event_id uuid references public.decision_events (id) on delete restrict,
  actor_id uuid not null default auth.uid() references auth.users (id),
  recorded_at timestamptz not null default now(),
  -- A decision needs an outcome and a reason from the criteria list (FR-DR-02).
  constraint decision_outcome_required check (kind in ('query', 'query_response') or outcome is not null),
  constraint decision_reason_required check (kind in ('query', 'query_response') or reason_code is not null),
  -- A correction must point at the event it corrects (FR-DR-04).
  constraint correction_points_back check (kind <> 'correction' or corrects_event_id is not null)
);

-- Who did what, and whether it was allowed (T-2, US-14, US-13).
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null check (length(trim(action)) > 0),
  target text,
  allowed boolean not null,
  occurred_at timestamptz not null default now()
);

-- Append-only enforcement (T-2, FR-DR-04). Updates and deletes raise an error
-- for every role, including the table owner.
create function public.refuse_change_to_append_only_table()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table % is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger decision_events_append_only
  before update or delete on public.decision_events
  for each row execute function public.refuse_change_to_append_only_table();

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.refuse_change_to_append_only_table();

-- Row-level security. Every table has it on, and no policy is open to anonymous users.
alter table public.user_roles enable row level security;
alter table public.batches enable row level security;
alter table public.batch_members enable row level security;
alter table public.decision_events enable row level security;
alter table public.audit_events enable row level security;

-- Helper: the signed-in user's permission level on a batch, or null if not a member.
-- Kept as a function so policies on decision_events do not repeat the join.
create function public.permission_on_batch(p_batch_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.permission_level
  from public.batch_members bm
  join public.user_roles ur on ur.user_id = bm.user_id
  where bm.batch_id = p_batch_id
    and bm.user_id = auth.uid();
$$;

-- user_roles: users read only their own row. Changes happen through the admin path
-- (not in this migration), so there are no insert, update, or delete policies.
create policy user_roles_read_own on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

-- batch_members: users read only their own memberships.
create policy batch_members_read_own on public.batch_members
  for select to authenticated
  using (user_id = auth.uid());

-- batches: members read their batches. Anyone signed in can create a batch as themselves.
create policy batches_read_member on public.batches
  for select to authenticated
  using (public.permission_on_batch(id) is not null);

create policy batches_create_as_self on public.batches
  for insert to authenticated
  with check (created_by = auth.uid());

-- decision_events: members with reviewer or owner level can add events (US-14, US-11).
-- Read-only members can read but not write. Actor must be the signed-in user.
create policy decision_events_read_member on public.decision_events
  for select to authenticated
  using (public.permission_on_batch(batch_id) is not null);

create policy decision_events_insert_reviewer on public.decision_events
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.permission_on_batch(batch_id) in ('reviewer', 'owner')
  );

-- audit_events: owners read everything. Others read only their own events.
create policy audit_events_read_own_or_owner on public.audit_events
  for select to authenticated
  using (
    actor_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.permission_level = 'owner'
    )
  );

create policy audit_events_insert_own on public.audit_events
  for insert to authenticated
  with check (actor_id = auth.uid());

-- Privileges. Anonymous users get nothing. Authenticated users get only the
-- operations the policies above allow. No update, delete, or truncate on the
-- append-only tables, in addition to the trigger.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.user_roles, public.batch_members, public.batches to authenticated;
grant insert on public.batches to authenticated;
grant select, insert on public.decision_events to authenticated;
grant select, insert on public.audit_events to authenticated;

grant execute on function public.permission_on_batch(uuid) to authenticated;
