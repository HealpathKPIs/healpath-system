import type { PoolClient } from 'pg';

import { governanceQuery, withGovernanceTransaction } from '@/lib/import-governance-db';
import { isVerifiedReconciliation, observationBatchStatus, type ReconciliationMetric, type ReconciliationResult, type ReconciliationState, type ValidationStatus } from '@/lib/import-reconciliation';

export type ImportBatchStatus = 'PREVIEW' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN' | 'ROLLED_BACK';

export interface ImportBatchSummary {
  id: string;
  importType: string;
  fileName: string | null;
  fileHash: string | null;
  fileSizeBytes: number | null;
  initiatedBy: string | null;
  initiatedByUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: ImportBatchStatus;
  source: string | null;
  notes: string | null;
  errorSummary: string | null;
  duplicateOfBatchId: string | null;
  createdAt: string;
  reconciliationStatus: ValidationStatus | null;
}

export interface ImportBatchDetail extends ImportBatchSummary {
  beforeState: ReconciliationState | null;
  afterState: ReconciliationState | null;
  metrics: ReconciliationMetric[];
  events: ImportEvent[];
}

export interface ImportEvent {
  id: string;
  eventType: string;
  eventTime: string;
  message: string;
  metadata: Record<string, unknown>;
}

export interface ImportGovernanceSummary {
  auditTablesAvailable: boolean;
  latestImport: ImportBatchSummary | null;
  latestVerifiedVersion: DataVersionSummary | null;
  latestReconciliation: { batchId: string; status: ValidationStatus; createdAt: string } | null;
  unresolvedCount: number;
}

export interface DataVersionSummary {
  id: string;
  createdAt: string;
  importBatchId: string | null;
  latestPrescriptionDate: string | null;
  latestReportingMonth: string | null;
  totalVisits: number;
  uniqueVisits: number;
  uniquePatients: number;
  status: 'VERIFIED' | 'REVOKED';
}

type BatchRow = {
  id: string;
  import_type: string;
  file_name: string | null;
  file_hash: string | null;
  file_size_bytes: number | null;
  initiated_by: string | null;
  initiated_by_user_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: ImportBatchStatus;
  source: string | null;
  notes: string | null;
  error_summary: string | null;
  duplicate_of_batch_id: string | null;
  created_at: string;
  reconciliation_status?: ValidationStatus | null;
};

function mapBatch(row: BatchRow): ImportBatchSummary {
  return {
    id: row.id,
    importType: row.import_type,
    fileName: row.file_name,
    fileHash: row.file_hash,
    fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    initiatedBy: row.initiated_by,
    initiatedByUserId: row.initiated_by_user_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    source: row.source,
    notes: row.notes,
    errorSummary: row.error_summary,
    duplicateOfBatchId: row.duplicate_of_batch_id,
    createdAt: row.created_at,
    reconciliationStatus: row.reconciliation_status ?? null,
  };
}

export async function governanceTablesAvailable() {
  try {
    const rows = await governanceQuery<{ batches: string | null; reconciliation: string | null; events: string | null; versions: string | null }>(`
      select
        to_regclass('healpath.import_batches')::text as batches,
        to_regclass('healpath.import_reconciliation')::text as reconciliation,
        to_regclass('healpath.import_events')::text as events,
        to_regclass('healpath.data_versions')::text as versions
    `);
    const row = rows[0];
    return Boolean(row?.batches && row.reconciliation && row.events && row.versions);
  } catch {
    return false;
  }
}

export async function listImportBatches(limit = 50): Promise<{ available: boolean; batches: ImportBatchSummary[] }> {
  if (!(await governanceTablesAvailable())) return { available: false, batches: [] };
  const rows = await governanceQuery<BatchRow>(`
    select b.*, r.validation_status as reconciliation_status
    from healpath.import_batches b
    left join lateral (
      select validation_status from healpath.import_reconciliation
      where import_batch_id = b.id order by created_at desc limit 1
    ) r on true
    order by b.created_at desc limit $1
  `, [Math.max(1, Math.min(200, limit))]);
  return { available: true, batches: rows.map(mapBatch) };
}

export async function getImportBatch(id: string): Promise<ImportBatchDetail | null> {
  if (!(await governanceTablesAvailable())) return null;
  const rows = await governanceQuery<BatchRow & { before_state: ReconciliationState | null; after_state: ReconciliationState | null }>(`
    select b.*, r.validation_status as reconciliation_status
    from healpath.import_batches b
    left join lateral (
      select validation_status from healpath.import_reconciliation
      where import_batch_id = b.id order by created_at desc limit 1
    ) r on true
    where b.id = $1
  `, [id]);
  const row = rows[0];
  if (!row) return null;
  const [metricRows, eventRows] = await Promise.all([
    governanceQuery<Record<string, unknown>>(`select * from healpath.import_reconciliation where import_batch_id = $1 order by table_name`, [id]),
    governanceQuery<{ id: string; event_type: string; event_time: string; message: string; metadata: Record<string, unknown> }>(`select id, event_type, event_time, message, metadata from healpath.import_events where import_batch_id = $1 order by event_time, id`, [id]),
  ]);
  return {
    ...mapBatch(row),
    beforeState: row.before_state,
    afterState: row.after_state,
    metrics: metricRows.map((metric) => ({
      tableName: String(metric.table_name),
      rowsBefore: metric.rows_before === null ? null : Number(metric.rows_before),
      rowsAfter: metric.rows_after === null ? null : Number(metric.rows_after),
      distinctKeysBefore: metric.distinct_keys_before === null ? null : Number(metric.distinct_keys_before),
      distinctKeysAfter: metric.distinct_keys_after === null ? null : Number(metric.distinct_keys_after),
      insertedCount: metric.inserted_count === null ? null : Number(metric.inserted_count),
      updatedCount: metric.updated_count === null ? null : Number(metric.updated_count),
      unchangedCount: metric.unchanged_count === null ? null : Number(metric.unchanged_count),
      rejectedCount: metric.rejected_count === null ? null : Number(metric.rejected_count),
      orphanCount: metric.orphan_count === null ? null : Number(metric.orphan_count),
      validationStatus: metric.validation_status as ValidationStatus,
      metrics: (metric.metrics ?? {}) as Record<string, unknown>,
    })),
    events: eventRows.map((event) => ({ id: event.id, eventType: event.event_type, eventTime: event.event_time, message: event.message, metadata: event.metadata ?? {} })),
  };
}

export async function findBatchByHash(fileHash: string): Promise<ImportBatchSummary | null> {
  if (!(await governanceTablesAvailable())) return null;
  const rows = await governanceQuery<BatchRow>(`select * from healpath.import_batches where file_hash = $1 order by created_at desc limit 1`, [fileHash]);
  return rows[0] ? mapBatch(rows[0]) : null;
}

export async function createObservationBatch(input: {
  importType: string;
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  initiatedBy: string;
  initiatedByUserId: string;
  source: string;
  beforeState: ReconciliationState;
  duplicateOfBatchId: string | null;
}) {
  return withGovernanceTransaction(async (client) => {
    const rows = await client.query<BatchRow>(`
      insert into healpath.import_batches
        (import_type, file_name, file_hash, file_size_bytes, initiated_by, initiated_by_user_id, started_at, status, source, notes, before_state, duplicate_of_batch_id)
      values ($1, $2, $3, $4, $5, $6, now(), 'PREVIEW', $7, $8, $9::jsonb, $10)
      returning *
    `, [input.importType, input.fileName, input.fileHash, input.fileSizeBytes, input.initiatedBy, input.initiatedByUserId, input.source, 'Observation only; existing importer remains unintegrated.', JSON.stringify(input.beforeState), input.duplicateOfBatchId]);
    const batch = rows.rows[0];
    await appendEvent(client, batch.id, 'PREVIEW_CREATED', 'Aggregate before-state captured; no importer was invoked.', { duplicateOfBatchId: input.duplicateOfBatchId });
    return mapBatch(batch);
  });
}

export async function recordObservation(input: { batchId: string; afterState: ReconciliationState; result: ReconciliationResult }) {
  return withGovernanceTransaction(async (client) => {
    await client.query(`update healpath.import_batches set after_state = $2::jsonb, completed_at = now(), status = $3, error_summary = $4 where id = $1`, [input.batchId, JSON.stringify(input.afterState), observationBatchStatus(input.result), input.result.failures.length ? input.result.failures.join(' ') : null]);
    for (const metric of input.result.metrics) {
      await client.query(`
        insert into healpath.import_reconciliation
          (import_batch_id, table_name, rows_before, rows_after, distinct_keys_before, distinct_keys_after, inserted_count, updated_count, unchanged_count, rejected_count, orphan_count, validation_status, metrics)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
        on conflict (import_batch_id, table_name) do update set rows_before = excluded.rows_before, rows_after = excluded.rows_after, distinct_keys_before = excluded.distinct_keys_before, distinct_keys_after = excluded.distinct_keys_after, inserted_count = excluded.inserted_count, updated_count = excluded.updated_count, unchanged_count = excluded.unchanged_count, rejected_count = excluded.rejected_count, orphan_count = excluded.orphan_count, validation_status = excluded.validation_status, metrics = excluded.metrics
      `, [input.batchId, metric.tableName, metric.rowsBefore, metric.rowsAfter, metric.distinctKeysBefore, metric.distinctKeysAfter, metric.insertedCount, metric.updatedCount, metric.unchangedCount, metric.rejectedCount, metric.orphanCount, metric.validationStatus, JSON.stringify(metric.metrics)]);
    }
    await appendEvent(client, input.batchId, input.result.status === 'FAIL' ? 'RECONCILIATION_FAILED' : 'RECONCILIATION_UNKNOWN', `Aggregate after-state captured with status ${input.result.status}.`, { unknowns: input.result.unknowns, warnings: input.result.warnings, failures: input.result.failures });
  });
}

export async function createVerifiedDataVersion(input: { batchId: string; afterState: ReconciliationState; result: ReconciliationResult }) {
  if (!isVerifiedReconciliation(input.result)) return null;
  return withGovernanceTransaction(async (client) => {
    const rows = await client.query<DataVersionSummary>(`
      insert into healpath.data_versions (import_batch_id, latest_prescription_date, latest_reporting_month, total_visits, unique_visits, unique_patients, status)
      values ($1, $2, $3, $4, $5, $6, 'VERIFIED') returning id, created_at as "createdAt", import_batch_id as "importBatchId", latest_prescription_date as "latestPrescriptionDate", latest_reporting_month as "latestReportingMonth", total_visits as "totalVisits", unique_visits as "uniqueVisits", unique_patients as "uniquePatients", status
    `, [input.batchId, input.afterState.latestPrescriptionDate, input.afterState.monthlyVisits ? Object.keys(input.afterState.monthlyVisits).sort().at(-1) ?? null : null, input.afterState.visitsTotal, input.afterState.uniqueVisitIds, input.afterState.uniquePatients]);
    return rows.rows[0] ?? null;
  });
}

export async function getImportGovernanceSummary(): Promise<ImportGovernanceSummary> {
  if (!(await governanceTablesAvailable())) return { auditTablesAvailable: false, latestImport: null, latestVerifiedVersion: null, latestReconciliation: null, unresolvedCount: 0 };
  const [imports, versions, reconciliations, unresolved] = await Promise.all([
    listImportBatches(1),
    governanceQuery<DataVersionSummary>(`select id, created_at as "createdAt", import_batch_id as "importBatchId", latest_prescription_date as "latestPrescriptionDate", latest_reporting_month as "latestReportingMonth", total_visits as "totalVisits", unique_visits as "uniqueVisits", unique_patients as "uniquePatients", status from healpath.data_versions where status = 'VERIFIED' order by created_at desc limit 1`),
    governanceQuery<{ batch_id: string; validation_status: ValidationStatus; created_at: string }>(`select import_batch_id as batch_id, validation_status, created_at from healpath.import_reconciliation order by created_at desc limit 1`),
    governanceQuery<{ count: number }>(`select count(*)::int as count from healpath.import_batches where status in ('FAILED', 'UNKNOWN')`),
  ]);
  const reconciliation = reconciliations[0];
  return { auditTablesAvailable: true, latestImport: imports.batches[0] ?? null, latestVerifiedVersion: versions[0] ?? null, latestReconciliation: reconciliation ? { batchId: reconciliation.batch_id, status: reconciliation.validation_status, createdAt: reconciliation.created_at } : null, unresolvedCount: Number(unresolved[0]?.count ?? 0) };
}

async function appendEvent(client: PoolClient, batchId: string, eventType: string, message: string, metadata: Record<string, unknown>) {
  await client.query(`insert into healpath.import_events (import_batch_id, event_type, message, metadata) values ($1, $2, $3, $4::jsonb)`, [batchId, eventType, message, JSON.stringify(metadata)]);
}
