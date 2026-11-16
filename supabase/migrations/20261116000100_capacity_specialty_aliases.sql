-- Durable mapping from the spelling a schedule writes to the specialty it means.
--
-- Without this, renaming a specialty only holds until the next import. The
-- October schedule writes "Internal"; renaming that row to "Internal Medicine"
-- left nothing matching "Internal", so the following import created a second
-- row under the old name and the doctors split across two rows reporting the
-- same specialty.
--
-- A parent is a different relationship and stays as it is: "Internal & ICU" is
-- a real sub-specialty that rolls up but keeps its own identity, whereas
-- "Internal" and "Internal Medicine" are one specialty spelled two ways.
--
-- Safe to run more than once.

begin;

create table if not exists healpath.capacity_specialty_aliases (
  alias_key    text primary key,
  alias_display text not null,
  specialty_id bigint not null references healpath.capacity_specialties(id) on delete cascade,
  source       text not null default 'manual' check (source in ('manual', 'rename', 'auto')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index if not exists capacity_specialty_aliases_specialty_idx
  on healpath.capacity_specialty_aliases (specialty_id);

alter table healpath.capacity_specialty_aliases enable row level security;

revoke all on healpath.capacity_specialty_aliases from public, anon;
grant select on healpath.capacity_specialty_aliases to authenticated;

drop policy if exists capacity_read on healpath.capacity_specialty_aliases;
create policy capacity_read on healpath.capacity_specialty_aliases
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active));

commit;
