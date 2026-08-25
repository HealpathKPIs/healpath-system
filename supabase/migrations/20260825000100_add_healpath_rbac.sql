-- HealPath two-role authentication and authorization.
-- Safe to run more than once in the Supabase SQL Editor.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'viewer',
  active boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists role text not null default 'viewer',
  add column if not exists active boolean not null default false,
  add column if not exists last_login timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_role_check,
  drop constraint if exists profiles_primary_admin_check;

update public.profiles
set
  email = lower(email),
  role = case
    when lower(email) = 'ahmedramadan@healpath.care' then 'admin'
    else 'viewer'
  end,
  active = case
    when lower(email) = 'ahmedramadan@healpath.care' then true
    else active
  end,
  updated_at = now();

alter table public.profiles
  alter column full_name set not null,
  alter column email set not null,
  alter column role set default 'viewer',
  alter column role set not null,
  alter column active set default false,
  alter column active set not null;

create unique index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'viewer')),
  add constraint profiles_primary_admin_check check (
    (
      lower(email) = 'ahmedramadan@healpath.care'
      and role = 'admin'
      and active
    )
    or (
      lower(email) <> 'ahmedramadan@healpath.care'
      and role = 'viewer'
    )
  );

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create or replace function public.healpath_set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.healpath_set_profile_updated_at()
  from public, anon, authenticated;

drop trigger if exists healpath_set_profile_updated_at on public.profiles;
create trigger healpath_set_profile_updated_at
  before update on public.profiles
  for each row execute procedure public.healpath_set_profile_updated_at();

create or replace function public.healpath_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  is_primary_admin boolean := normalized_email = 'ahmedramadan@healpath.care';
begin
  insert into public.profiles (
    id,
    full_name,
    email,
    role,
    active,
    created_at,
    updated_at
  ) values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'HealPath User'
    ),
    normalized_email,
    case when is_primary_admin then 'admin' else 'viewer' end,
    is_primary_admin,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.healpath_handle_new_auth_user()
  from public, anon, authenticated;

drop trigger if exists healpath_on_auth_user_created on auth.users;
create trigger healpath_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.healpath_handle_new_auth_user();

insert into public.profiles (
  id,
  full_name,
  email,
  role,
  active,
  created_at,
  updated_at
)
select
  users.id,
  coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'HealPath User'
  ),
  lower(coalesce(users.email, '')),
  case when lower(coalesce(users.email, '')) = 'ahmedramadan@healpath.care' then 'admin' else 'viewer' end,
  lower(coalesce(users.email, '')) = 'ahmedramadan@healpath.care',
  coalesce(users.created_at, now()),
  now()
from auth.users as users
on conflict (id) do nothing;

commit;

