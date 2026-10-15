-- Sincroniza usuários do Supabase Auth com public.profiles.
-- Esta migração é idempotente e pode ser executada pelo SQL Editor.

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
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_profile_updated on auth.users;
create trigger on_auth_user_profile_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;

insert into public.profiles (id, email, display_name)
select
  users.id,
  users.email,
  coalesce(
    users.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(users.email, ''), '@', 1)
  )
from auth.users as users
on conflict (id) do update
set
  email = excluded.email,
  display_name = coalesce(public.profiles.display_name, excluded.display_name);
