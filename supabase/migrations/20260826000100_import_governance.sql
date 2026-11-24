-- Phase 2: additive import governance only.
-- This migration is intentionally not executed against production by Phase 2.
-- It does not alter existing fact tables, keys, constraints, or importer behavior.

begin;

do $$
begin
  if to_regclass('public.profiles') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'Required authentication objects are unavailable: public.profiles and auth.uid()';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Required Supabase roles are unavailable: anon, authenticated, service_role';
  end if;
end $$;

-- Fail closed if a governance object already exists with a schema that this
-- migration cannot prove compatible. `IF NOT EXISTS` alone is not validation.
do $$
begin
  if to_regclass('healpath.import_batches') is not null and (
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_batches' and column_name = 'id' and udt_name = 'uuid') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_batches' and column_name = 'status' and udt_name = 'text') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_batches' and column_name = 'initiated_by_user_id' and udt_name = 'uuid')
  ) then
    raise exception 'Incompatible existing schema: healpath.import_batches';
  end if;
  if to_regclass('healpath.import_reconciliation') is not null and (
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_reconciliation' and column_name = 'id' and udt_name = 'int8') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_reconciliation' and column_name = 'import_batch_id' and udt_name = 'uuid') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_reconciliation' and column_name = 'validation_status' and udt_name = 'text')
  ) then
    raise exception 'Incompatible existing schema: healpath.import_reconciliation';
  end if;
  if to_regclass('healpath.import_events') is not null and (
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_events' and column_name = 'id' and udt_name = 'int8') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'import_events' and column_name = 'import_batch_id' and udt_name = 'uuid')
  ) then
    raise exception 'Incompatible existing schema: healpath.import_events';
  end if;
  if to_regclass('healpath.data_versions') is not null and (
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'data_versions' and column_name = 'id' and udt_name = 'uuid') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'data_versions' and column_name = 'import_batch_id' and udt_name = 'uuid') or
    not exists (select 1 from information_schema.columns where table_schema = 'healpath' and table_name = 'data_versions' and column_name = 'status' and udt_name = 'text')
  ) then
    raise exception 'Incompatible existing schema: healpath.data_versions';
  end if;
end $$;

do $$
declare c record;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid in (to_regclass('healpath.import_batches'), to_regclass('healpath.import_reconciliation'), to_regclass('healpath.import_events'))
      and conname in (
        'import_batches_initiated_by_check', 'import_batches_before_state_object_check',
        'import_batches_after_state_object_check', 'import_batches_state_sensitive_key_check',
        'import_reconciliation_metrics_object_check', 'import_reconciliation_metrics_sensitive_key_check',
        'import_events_metadata_object_check', 'import_events_metadata_sensitive_key_check'
      )
  loop
    if c.conname like '%object_check' and c.definition not like '%jsonb_typeof%' then
      raise exception 'Incompatible existing governance constraint: %', c.conname;
    elsif c.conname like '%sensitive_key_check' and c.definition not like '%patient%' then
      raise exception 'Incompatible existing governance constraint: %', c.conname;
    elsif c.conname = 'import_batches_initiated_by_check' and c.definition not like '%initiated_by%' then
      raise exception 'Incompatible existing governance constraint: %', c.conname;
    end if;
  end loop;
end $$;

create table if not exists healpath.import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,
  file_name text,
  file_hash text,
  file_size_bytes bigint,
  initiated_by text,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null check (status in ('PREVIEW', 'RUNNING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'ROLLED_BACK')),
  source text,
  -- initiated_by is a legacy display value; initiated_by_user_id is the
  -- authoritative identity FK used by new governance writes.
  initiated_by_user_id uuid references public.profiles(id),
  notes text,
  error_summary text,
  before_state jsonb,
  after_state jsonb,
  duplicate_of_batch_id uuid references healpath.import_batches(id),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_batches'::regclass and conname = 'import_batches_initiated_by_check') then
    alter table healpath.import_batches add constraint import_batches_initiated_by_check
      check (initiated_by is null or initiated_by ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  elsif not exists (select 1 from pg_constraint where conrelid = 'healpath.import_batches'::regclass and conname = 'import_batches_initiated_by_check' and pg_get_constraintdef(oid) like '%initiated_by%') then
    raise exception 'Incompatible existing constraint: healpath.import_batches.import_batches_initiated_by_check';
  end if;
end $$;

create table if not exists healpath.import_reconciliation (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references healpath.import_batches(id),
  table_name text not null,
  rows_before bigint,
  rows_after bigint,
  distinct_keys_before bigint,
  distinct_keys_after bigint,
  inserted_count bigint,
  updated_count bigint,
  unchanged_count bigint,
  rejected_count bigint,
  orphan_count bigint,
  validation_status text not null check (validation_status in ('PASS', 'WARNING', 'FAIL', 'UNKNOWN')),
  metrics jsonb,
  created_at timestamptz not null default now(),
  unique (import_batch_id, table_name)
);

create table if not exists healpath.import_events (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references healpath.import_batches(id),
  event_type text not null,
  event_time timestamptz not null default now(),
  message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists healpath.data_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  import_batch_id uuid references healpath.import_batches(id),
  latest_prescription_date timestamptz,
  latest_reporting_month text,
  total_visits bigint not null,
  unique_visits bigint not null,
  unique_patients bigint not null,
  status text not null check (status in ('VERIFIED', 'REVOKED'))
);

create index if not exists import_batches_created_at_idx on healpath.import_batches (created_at desc);
create index if not exists import_batches_file_hash_idx on healpath.import_batches (file_hash);
create index if not exists import_batches_status_idx on healpath.import_batches (status);
create index if not exists import_events_batch_time_idx on healpath.import_events (import_batch_id, event_time);
create index if not exists import_reconciliation_batch_idx on healpath.import_reconciliation (import_batch_id);
create index if not exists data_versions_created_at_idx on healpath.data_versions (created_at desc);

-- Governance metadata is aggregate-only. These conservative checks reject
-- sensitive field names in JSON text; application validation remains required
-- because SQL cannot prove that an arbitrary value is not patient-level data.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_batches'::regclass and conname = 'import_batches_before_state_object_check') then
    alter table healpath.import_batches add constraint import_batches_before_state_object_check check (before_state is null or jsonb_typeof(before_state) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_batches'::regclass and conname = 'import_batches_after_state_object_check') then
    alter table healpath.import_batches add constraint import_batches_after_state_object_check check (after_state is null or jsonb_typeof(after_state) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_batches'::regclass and conname = 'import_batches_state_sensitive_key_check') then
    alter table healpath.import_batches add constraint import_batches_state_sensitive_key_check check (
      (before_state is null or before_state::text !~* '"(patient[_ -]?(id|ids|name|record|row|data)|visit[_ -]?(id|ids)|prescription(s)?|diagnos(is|es)?|lab(oratory)?(s)?|scan(s)?|drug(s)?|medication(s)?|raw[_ -]?row(s)?)"[[:space:]]*:') and
      (after_state is null or after_state::text !~* '"(patient[_ -]?(id|ids|name|record|row|data)|visit[_ -]?(id|ids)|prescription(s)?|diagnos(is|es)?|lab(oratory)?(s)?|scan(s)?|drug(s)?|medication(s)?|raw[_ -]?row(s)?)"[[:space:]]*:')
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_reconciliation'::regclass and conname = 'import_reconciliation_metrics_object_check') then
    alter table healpath.import_reconciliation add constraint import_reconciliation_metrics_object_check check (metrics is null or jsonb_typeof(metrics) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_reconciliation'::regclass and conname = 'import_reconciliation_metrics_sensitive_key_check') then
    alter table healpath.import_reconciliation add constraint import_reconciliation_metrics_sensitive_key_check check (metrics is null or metrics::text !~* '"(patient[_ -]?(id|ids|name|record|row|data)|visit[_ -]?(id|ids)|prescription(s)?|diagnos(is|es)?|lab(oratory)?(s)?|scan(s)?|drug(s)?|medication(s)?|raw[_ -]?row(s)?)"[[:space:]]*:');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_events'::regclass and conname = 'import_events_metadata_object_check') then
    alter table healpath.import_events add constraint import_events_metadata_object_check check (metadata is null or jsonb_typeof(metadata) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'healpath.import_events'::regclass and conname = 'import_events_metadata_sensitive_key_check') then
    alter table healpath.import_events add constraint import_events_metadata_sensitive_key_check check (metadata::text !~* '"(patient[_ -]?(id|ids|name|record|row|data)|visit[_ -]?(id|ids)|prescription(s)?|diagnos(is|es)?|lab(oratory)?(s)?|scan(s)?|drug(s)?|medication(s)?|raw[_ -]?row(s)?)"[[:space:]]*:');
  end if;
end $$;

-- Default-deny access for PostgREST roles. The authenticated role receives
-- SELECT only; writes are performed by the server-side governance service and
-- are still protected by the admin API boundary. service_role is explicit so
-- the policy intent is clear; it bypasses RLS by Supabase design.
alter table healpath.import_batches enable row level security;
alter table healpath.import_reconciliation enable row level security;
alter table healpath.import_events enable row level security;
alter table healpath.data_versions enable row level security;

revoke all on table healpath.import_batches, healpath.import_reconciliation, healpath.import_events, healpath.data_versions from public, anon, authenticated, service_role;
grant select on table healpath.import_batches, healpath.import_reconciliation, healpath.import_events, healpath.data_versions to authenticated;
grant select, insert, update on table healpath.import_batches, healpath.import_reconciliation to service_role;
grant select, insert on table healpath.import_events, healpath.data_versions to service_role;
revoke all on sequence healpath.import_reconciliation_id_seq, healpath.import_events_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence healpath.import_reconciliation_id_seq, healpath.import_events_id_seq to service_role;

drop policy if exists import_batches_admin_select on healpath.import_batches;
create policy import_batches_admin_select on healpath.import_batches for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'));
drop policy if exists import_reconciliation_admin_select on healpath.import_reconciliation;
create policy import_reconciliation_admin_select on healpath.import_reconciliation for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'));
drop policy if exists import_events_admin_select on healpath.import_events;
create policy import_events_admin_select on healpath.import_events for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'));
drop policy if exists data_versions_admin_select on healpath.data_versions;
create policy data_versions_admin_select on healpath.data_versions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'));

comment on table healpath.import_batches is 'Aggregate import governance only; never store patient-level rows or identifiers.';
comment on table healpath.import_reconciliation is 'Aggregate before/after reconciliation only; exact row attribution may remain UNKNOWN.';
comment on table healpath.import_events is 'Append-only aggregate governance events; metadata must not contain patient-level data.';
comment on table healpath.data_versions is 'Verified aggregate data versions only; legacy rows remain unattributed.';
comment on column healpath.import_batches.initiated_by is 'Legacy display text only; authoritative new identity is initiated_by_user_id.';
comment on column healpath.import_batches.initiated_by_user_id is 'Optional FK to public.profiles for authoritative governance attribution; nullable for legacy observations.';

commit;
