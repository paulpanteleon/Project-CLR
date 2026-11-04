-- Test-only stand-in for the parts of Supabase the migration depends on:
-- the anon and authenticated roles, the auth schema, auth.users, and auth.uid().
-- Supabase provides these in production. This file never runs against Supabase.
-- auth.uid() reads the same request.jwt.claim.sub setting Supabase uses.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
