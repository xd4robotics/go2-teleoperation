-- Schema inicial do painel XD4 Robotics.
-- Execute pelo Supabase CLI ou pelo SQL Editor do projeto.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'operator' check (role in ('operator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.login_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'web',
  ip_address inet,
  user_agent text,
  logged_at timestamptz not null default now()
);

create table if not exists public.robot_status (
  robot_id text primary key,
  robot_online boolean not null default false,
  network_online boolean not null default false,
  sdk_connected boolean not null default false,
  battery_percent smallint check (battery_percent between 0 and 100),
  video_stream_url text,
  map_data_url text,
  telemetry jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.robot_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  robot_id text not null default 'primary',
  command text not null check (
    command in ('forward', 'backward', 'left', 'right', 'raise', 'lower', 'stop', 'emergency_stop')
  ),
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.oracle_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  robot_id text not null default 'primary',
  image_url text,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  metadata jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists login_logs_user_logged_at_idx
  on public.login_logs (user_id, logged_at desc);
create index if not exists robot_commands_pending_idx
  on public.robot_commands (robot_id, status, created_at);
create index if not exists robot_commands_user_idx
  on public.robot_commands (user_id, created_at desc);
create index if not exists oracle_analyses_user_idx
  on public.oracle_analyses (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists robot_status_set_updated_at on public.robot_status;
create trigger robot_status_set_updated_at
before update on public.robot_status
for each row execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;

insert into public.robot_status (robot_id)
values ('primary')
on conflict (robot_id) do nothing;

alter table public.profiles enable row level security;
alter table public.login_logs enable row level security;
alter table public.robot_status enable row level security;
alter table public.robot_commands enable row level security;
alter table public.oracle_analyses enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "users_read_own_profile" on public.profiles;
create policy "users_read_own_profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "users_read_own_login_logs" on public.login_logs;
create policy "users_read_own_login_logs"
on public.login_logs for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "users_insert_own_login_logs" on public.login_logs;
create policy "users_insert_own_login_logs"
on public.login_logs for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "authenticated_read_robot_status" on public.robot_status;
create policy "authenticated_read_robot_status"
on public.robot_status for select to authenticated
using (true);

drop policy if exists "users_read_own_commands" on public.robot_commands;
create policy "users_read_own_commands"
on public.robot_commands for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "users_queue_own_commands" on public.robot_commands;
create policy "users_queue_own_commands"
on public.robot_commands for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'queued');

drop policy if exists "users_read_own_analyses" on public.oracle_analyses;
create policy "users_read_own_analyses"
on public.oracle_analyses for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "users_queue_own_analyses" on public.oracle_analyses;
create policy "users_queue_own_analyses"
on public.oracle_analyses for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'queued');

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.login_logs from anon, authenticated;
revoke all on table public.robot_status from anon, authenticated;
revoke all on table public.robot_commands from anon, authenticated;
revoke all on table public.oracle_analyses from anon, authenticated;
revoke all on sequence public.login_logs_id_seq from anon, authenticated;

grant select, update (display_name) on public.profiles to authenticated;
grant select, insert on public.login_logs to authenticated;
grant select on public.robot_status to authenticated;
grant select, insert on public.robot_commands to authenticated;
grant select, insert on public.oracle_analyses to authenticated;
grant usage, select on sequence public.login_logs_id_seq to authenticated;

-- O service_role usado pelo bridge do backend ignora RLS. A chave nunca deve ir ao navegador.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'robot_status'
  ) then
    alter publication supabase_realtime add table public.robot_status;
  end if;
end;
$$;
