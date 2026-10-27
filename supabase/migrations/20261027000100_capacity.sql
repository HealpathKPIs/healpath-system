-- Capacity analysis: schedule hours, appointments, utilisation and yield.
--
-- PHI boundary: healpath.capacity_appointments is patient-free by construction.
-- The source export carries patient name, mobile, MRN, gender, age, insurance
-- provider, insured member, TPA, policy holder and appointment id. None of it
-- is parsed into a row and none of it is stored. Do not add a patient-
-- identifying column to any capacity table.
--
-- Safe to run more than once.

begin;

create schema if not exists healpath;

-- ---------------------------------------------------------------------------
-- Name key. MUST stay identical to normalizePersonName() in
-- lib/capacity/names.ts, which is what lets stored rows be re-linked in SQL
-- after somebody corrects a doctor alias. tests/capacity-parsers.test.ts and
-- the schema test assert the two agree.
-- ---------------------------------------------------------------------------
create or replace function healpath.capacity_name_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce(value, '')), '[‎‏]', '', 'g'),
          '[._\-'']', ' ', 'g'),
        '\m(prof|professor|dr|doctor|mr|mrs|ms|miss)\M\.?', ' ', 'g'),
      '[^a-z0-9؀-ۿ ]+', ' ', 'g'),
    '\s+', ' ', 'g')
  )
$$;

-- ---------------------------------------------------------------------------
-- Curated dimensions. An import only ever inserts into these; it never
-- deletes. They hold decisions a person made, which must survive a re-upload.
-- ---------------------------------------------------------------------------
create table if not exists healpath.capacity_specialties (
  id         bigint generated always as identity primary key,
  name       text not null,
  name_key   text generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  -- Tri-state parent, and collapsing it loses meaning:
  --   parent_override_set = false  -> follow the automatic "X & Y" rule
  --   true  + parent_id null       -> stands alone, suppressing the rule
  --   true  + parent_id set        -> reports under that specialty
  parent_id          bigint references healpath.capacity_specialties(id) on delete set null,
  parent_override_set boolean not null default false,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists capacity_specialties_key_uidx
  on healpath.capacity_specialties (name_key);

create table if not exists healpath.capacity_practitioners (
  id           bigint generated always as identity primary key,
  display_name text not null,
  name_key     text not null,
  specialty_id bigint references healpath.capacity_specialties(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists capacity_practitioners_key_uidx
  on healpath.capacity_practitioners (name_key);

create table if not exists healpath.capacity_practitioner_aliases (
  alias_key       text primary key,
  alias_display   text not null,
  practitioner_id bigint not null references healpath.capacity_practitioners(id) on delete cascade,
  -- 'auto' is only written at or above the auto-link threshold; everything
  -- weaker waits for a person. 'rejected' means "not the same person" and
  -- stops the suggestion coming back.
  source          text not null check (source in ('manual', 'auto', 'exact', 'rejected')),
  confidence      numeric(4,3),
  match_reason    text,
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Import ledger. One batch may carry several files: a month of schedule needs
-- both the Specialties and the Family Medicine workbook, and only together do
-- they make the month's real rostered hours.
-- ---------------------------------------------------------------------------
create table if not exists healpath.capacity_import_batches (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('schedule', 'appointments')),
  coverage_start    date,
  coverage_end      date,
  rows_parsed       integer not null default 0,
  rows_inserted     integer not null default 0,
  rows_deleted      integer not null default 0,
  rows_rejected     integer not null default 0,
  practitioners_new integer not null default 0,
  specialties_new   integer not null default 0,
  status            text not null check (status in ('PREVIEW', 'COMPLETED', 'FAILED')),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  duration_ms       integer not null default 0,
  imported_by       uuid references public.profiles(id),
  imported_by_email text,
  issues            jsonb not null default '[]'::jsonb,
  constraint capacity_batches_issues_is_array check (jsonb_typeof(issues) = 'array'),
  -- The issues blob is free-form, so fence it off explicitly.
  constraint capacity_batches_issues_no_phi check (
    issues::text !~* '"(patient[_ -]?(id|ids|name|record|row|data)|mrn|mobile|insur\w*|tpa)"[[:space:]]*:'
  )
);

create table if not exists healpath.capacity_import_files (
  id              bigint generated always as identity primary key,
  batch_id        uuid not null references healpath.capacity_import_batches(id) on delete cascade,
  file_name       text not null,
  file_hash       text not null,
  file_size_bytes bigint not null,
  object_key      text,
  rows_parsed     integer not null default 0,
  created_at      timestamptz not null default now()
);
-- Looked up to warn that a file has been imported before. Deliberately NOT
-- unique: re-importing the same bytes is a legitimate action (re-run a month
-- after correcting a doctor link), and the application asks for confirmation
-- first. What actually prevents double counting is replacing the whole
-- coverage window inside the import transaction, not uniqueness here.
create index if not exists capacity_import_files_hash_idx
  on healpath.capacity_import_files (file_hash);

drop index if exists healpath.capacity_import_files_hash_uidx;

-- ---------------------------------------------------------------------------
-- Facts
-- ---------------------------------------------------------------------------
create table if not exists healpath.capacity_schedule_shifts (
  id                    bigint generated always as identity primary key,
  batch_id              uuid not null references healpath.capacity_import_batches(id) on delete cascade,
  work_date             date not null,
  practitioner_id       bigint not null references healpath.capacity_practitioners(id),
  source_doctor_text    text not null,
  specialty_id          bigint references healpath.capacity_specialties(id),
  source_specialty_text text,
  start_min             smallint not null check (start_min between 0 and 1439),
  end_min               smallint not null check (end_min between 1 and 1440),
  minutes               smallint generated always as (end_min - start_min) stored,
  carried_from_date     date,
  note                  text,
  source_sheet          text,
  source_row            integer,
  constraint capacity_shift_order check (end_min > start_min),
  constraint capacity_shift_length check (end_min - start_min <= 16 * 60)
);
create unique index if not exists capacity_shift_uidx
  on healpath.capacity_schedule_shifts (work_date, practitioner_id, start_min, end_min);
create index if not exists capacity_shift_date_idx
  on healpath.capacity_schedule_shifts (work_date);

create table if not exists healpath.capacity_leave_days (
  id                    bigint generated always as identity primary key,
  batch_id              uuid not null references healpath.capacity_import_batches(id) on delete cascade,
  work_date             date not null,
  practitioner_id       bigint not null references healpath.capacity_practitioners(id),
  source_doctor_text    text not null,
  specialty_id          bigint references healpath.capacity_specialties(id),
  source_specialty_text text,
  leave_kind            text not null check (leave_kind in ('leave', 'off', 'absent', 'unknown')),
  -- Hours that were rostered but will not be worked. Recorded for the record,
  -- never counted as capacity; a booking on this day reads as not rostered.
  planned_minutes       smallint not null default 0,
  note                  text,
  source_sheet          text,
  source_row            integer
);
create unique index if not exists capacity_leave_uidx
  on healpath.capacity_leave_days (work_date, practitioner_id, leave_kind);

create table if not exists healpath.capacity_appointments (
  id                    bigint generated always as identity primary key,
  batch_id              uuid not null references healpath.capacity_import_batches(id) on delete cascade,
  appt_date             date not null,
  start_min             smallint check (start_min between 0 and 1439),
  duration_min          smallint,
  practitioner_id       bigint not null references healpath.capacity_practitioners(id),
  source_doctor_text    text not null,
  specialty_id          bigint references healpath.capacity_specialties(id),
  source_specialty_text text,
  status_raw            text,
  status_bucket         text not null check (status_bucket in ('completed', 'canceled', 'noshow', 'other')),
  appt_type             text,
  appt_mode             text,
  cancel_reason         text
);
-- Deliberately no unique key on the business tuple. Two appointments for the
-- same doctor at the same minute are a DOUBLE BOOKING, which is one of the
-- things this feature exists to measure. Uniqueness is enforced one level up,
-- by replacing the whole coverage window on re-import.
create index if not exists capacity_appt_date_idx on healpath.capacity_appointments (appt_date);
create index if not exists capacity_appt_pract_idx on healpath.capacity_appointments (practitioner_id, appt_date);
create index if not exists capacity_appt_batch_idx on healpath.capacity_appointments (batch_id);

comment on table healpath.capacity_appointments is
  'PHI-free by construction. Patient name, mobile, MRN, gender, age, insurance, TPA, policy holder and appointment id are discarded at parse time and are never written. Do not add patient-identifying columns.';

-- ---------------------------------------------------------------------------
-- Settings and duration rules
-- ---------------------------------------------------------------------------
create table if not exists healpath.capacity_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into healpath.capacity_settings (key, value) values
  ('default_slot_minutes', '15'::jsonb),
  ('am_boundary_minutes',  '720'::jsonb),
  ('bracket_width_minutes','120'::jsonb),
  ('specialty_level',      '"group"'::jsonb),
  -- Pinned, never auto-detected: the export writes dd/mm/yyyy, and guessing
  -- from a sample flips a month of low day numbers to US order silently.
  ('date_order',           '"dmy"'::jsonb),
  -- 'rules' reproduces the source tool; 'export' trusts the file's own
  -- duration column. They agree while every row is 15 minutes.
  ('duration_source',      '"rules"'::jsonb)
on conflict (key) do nothing;

-- The one documented exception to the automatic "X & Y rolls up under X" rule.
-- "Internal &Endocrine" is Dr Wael, who reports under Endocrinology rather than
-- Internal. It is seeded as data, not written into the grouping code, so the
-- next exception is a dropdown change rather than a deploy.
insert into healpath.capacity_specialties (name, parent_override_set) values ('Endocrinology', false)
on conflict (name_key) do nothing;

insert into healpath.capacity_specialties (name, parent_override_set) values ('Internal &Endocrine', true)
on conflict (name_key) do update set parent_override_set = true;

update healpath.capacity_specialties child
   set parent_id = parent.id
  from healpath.capacity_specialties parent
 where child.name_key = 'internal &endocrine'
   and parent.name_key = 'endocrinology'
   and child.parent_id is distinct from parent.id;

create table if not exists healpath.capacity_duration_rules (
  id           bigint generated always as identity primary key,
  appt_type    text,
  specialty_id bigint references healpath.capacity_specialties(id) on delete cascade,
  minutes      smallint not null check (minutes between 1 and 480),
  priority     integer not null default 100,
  active       boolean not null default true,
  constraint capacity_rule_not_empty check (appt_type is not null or specialty_id is not null)
);

-- ---------------------------------------------------------------------------
-- Re-link stored rows from the alias table. This is what makes correcting a
-- doctor link a seconds-long operation instead of a fresh 8.86 MB export.
-- ---------------------------------------------------------------------------
create or replace function healpath.capacity_relink(p_start date, p_end date)
returns integer
language plpgsql
as $$
declare
  changed integer := 0;
begin
  with resolved as (
    select a.id,
           coalesce(al.practitioner_id, p.id) as new_id
      from healpath.capacity_appointments a
      left join healpath.capacity_practitioner_aliases al
             on al.alias_key = healpath.capacity_name_key(a.source_doctor_text)
            and al.source <> 'rejected'
      left join healpath.capacity_practitioners p
             on p.name_key = healpath.capacity_name_key(a.source_doctor_text)
     where a.appt_date between p_start and p_end
  )
  update healpath.capacity_appointments a
     set practitioner_id = r.new_id
    from resolved r
   where a.id = r.id
     and r.new_id is not null
     and a.practitioner_id <> r.new_id;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Viewers must SEE capacity results, so the facts and dimensions are
-- readable by any active profile. The ledger names files and importers, so it
-- is admin-only. Writes go over DATABASE_URL as table owner, as every other
-- importer in this project does; these policies protect the PostgREST surface.
-- ---------------------------------------------------------------------------
alter table healpath.capacity_appointments       enable row level security;
alter table healpath.capacity_schedule_shifts    enable row level security;
alter table healpath.capacity_leave_days         enable row level security;
alter table healpath.capacity_practitioners      enable row level security;
alter table healpath.capacity_specialties        enable row level security;
alter table healpath.capacity_practitioner_aliases enable row level security;
alter table healpath.capacity_settings           enable row level security;
alter table healpath.capacity_duration_rules     enable row level security;
alter table healpath.capacity_import_batches     enable row level security;
alter table healpath.capacity_import_files       enable row level security;

revoke all on healpath.capacity_appointments, healpath.capacity_schedule_shifts,
              healpath.capacity_leave_days, healpath.capacity_practitioners,
              healpath.capacity_specialties, healpath.capacity_practitioner_aliases,
              healpath.capacity_settings, healpath.capacity_duration_rules,
              healpath.capacity_import_batches, healpath.capacity_import_files
  from public, anon;

grant select on healpath.capacity_appointments, healpath.capacity_schedule_shifts,
                healpath.capacity_leave_days, healpath.capacity_practitioners,
                healpath.capacity_specialties, healpath.capacity_practitioner_aliases,
                healpath.capacity_settings, healpath.capacity_duration_rules
  to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'capacity_appointments', 'capacity_schedule_shifts', 'capacity_leave_days',
    'capacity_practitioners', 'capacity_specialties', 'capacity_practitioner_aliases',
    'capacity_settings', 'capacity_duration_rules'
  ] loop
    execute format('drop policy if exists capacity_read on healpath.%I', t);
    execute format($p$
      create policy capacity_read on healpath.%I
        for select to authenticated
        using (exists (select 1 from public.profiles p
                        where p.id = auth.uid() and p.active))
    $p$, t);
  end loop;

  foreach t in array array['capacity_import_batches', 'capacity_import_files'] loop
    execute format('drop policy if exists capacity_admin_read on healpath.%I', t);
    execute format($p$
      create policy capacity_admin_read on healpath.%I
        for select to authenticated
        using (exists (select 1 from public.profiles p
                        where p.id = auth.uid() and p.active and p.role = 'admin'))
    $p$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Upload bucket. Private, with no policies on storage.objects: the signed
-- upload URL is minted by the service role and honoured by Storage directly,
-- and the server downloads with the service role, so no browser session needs
-- standing access. Deny-by-default is the strongest configuration here.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capacity-imports', 'capacity-imports', false, 52428800,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
