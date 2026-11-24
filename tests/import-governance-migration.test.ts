import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const migration = readFileSync(path.join(root, 'supabase/migrations/20260826000100_import_governance.sql'), 'utf8');
const rollback = readFileSync(path.join(root, 'supabase/migrations/20260826000101_drop_import_governance.sql'), 'utf8');

test('governance migration has explicit RLS and admin-only authenticated policies', () => {
  for (const table of ['import_batches', 'import_reconciliation', 'import_events', 'data_versions']) {
    assert.match(migration, new RegExp(`alter table healpath\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`create policy [^\\n]+ on healpath\\.${table} for select to authenticated`, 'i'));
  }
  assert.match(migration, /public\.profiles p where p\.id = auth\.uid\(\) and p\.active and p\.role = 'admin'/i);
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant .* to anon/i);
});

test('governance JSONB has object and sensitive-key checks with application-boundary limitation documented', () => {
  assert.match(migration, /jsonb_typeof\(before_state\)/i);
  assert.match(migration, /jsonb_typeof\(after_state\)/i);
  assert.match(migration, /jsonb_typeof\(metrics\)/i);
  assert.match(migration, /jsonb_typeof\(metadata\)/i);
  assert.match(migration, /application validation remains required/i);
  assert.match(migration, /patient.*prescription.*diagnos.*lab.*scan/i);
  assert.ok(migration.includes("'\"(patient[_ -]?"));
  assert.ok(migration.includes('[[:space:]]*:'));
});

test('authoritative initiator identity uses the existing profiles foreign key', () => {
  assert.match(migration, /initiated_by_user_id uuid references public\.profiles\(id\)/i);
  assert.match(migration, /initiated_by is a legacy display value/i);
  assert.match(migration, /authoritative new identity is initiated_by_user_id/i);
});

test('incompatible existing governance schemas fail closed', () => {
  assert.match(migration, /to_regclass\('healpath\.import_batches'\)/i);
  assert.match(migration, /information_schema\.columns/i);
  assert.match(migration, /raise exception 'Incompatible existing schema/i);
  assert.match(migration, /Incompatible existing governance constraint/i);
});

test('rollback is scoped to governance objects and never references fact tables', () => {
  const body = rollback.replace(/--[^\n]*/g, '').toLowerCase();
  assert.match(body, /drop table if exists healpath\.data_versions/);
  assert.match(body, /drop table if exists healpath\.import_events/);
  assert.match(body, /drop table if exists healpath\.import_reconciliation/);
  assert.match(body, /drop table if exists healpath\.import_batches/);
  assert.doesNotMatch(body, /healpath\.(visits|diagnosis_fact|drug_fact|lab_fact|scan_fact|patient_master)/);
  assert.doesNotMatch(body, /create|insert|update|delete|upsert/);
});

test('anonymous and non-admin access are denied by role grants and the admin predicate', () => {
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*to anon/i);
  assert.match(migration, /p\.role = 'admin'/i);
  assert.match(migration, /p\.active/i);
});

test('migration is transactional and rerun-safe for governance objects', () => {
  assert.match(migration.trim(), /^--[\s\S]*begin;[\s\S]*commit;\s*$/i);
  assert.match(migration, /create table if not exists healpath\./i);
  assert.match(migration, /create index if not exists/i);
  assert.match(migration, /drop policy if exists/i);
});

test('migration only creates or alters governance objects', () => {
  const body = migration.replace(/--[^\n]*/g, '').toLowerCase();
  assert.doesNotMatch(body, /healpath\.(visits|diagnosis_fact|drug_fact|lab_fact|scan_fact|patient_master)/);
  assert.doesNotMatch(body, /(?:insert|update|delete|upsert)\s+(?:into\s+)?healpath\./);
  assert.match(body, /create table if not exists healpath\.(import_batches|import_reconciliation|import_events|data_versions)/);
  assert.match(body, /alter table healpath\.(import_batches|import_reconciliation|import_events|data_versions)/);
});
