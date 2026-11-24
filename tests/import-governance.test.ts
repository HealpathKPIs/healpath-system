import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fingerprintBuffer } from '../lib/import-fingerprint';
import { isVerifiedReconciliation, observationBatchStatus, reconcileAcute, type ReconciliationState } from '../lib/import-reconciliation';

function state(overrides: Partial<ReconciliationState> = {}): ReconciliationState {
  return {
    capturedAt: '2026-08-26T00:00:00.000Z', visitsTotal: 10, uniqueVisitIds: 10, uniquePatients: 8,
    dashboardEligibleVisits: 10, outsideDashboardScope: 0, diagnosisRows: 10, drugRows: 10, labRows: 10, scanRows: 10,
    earliestPrescriptionDate: '2026-01-01', latestPrescriptionDate: '2026-06-30', monthlyVisits: { '2026-06': 10 },
    missingPatientIds: 0, missingPrescriptionDates: 0, missingMonthYears: 0, missingDoctors: 0, missingSpecialties: 0,
    factOrphans: { diagnosis_fact: 0, drug_fact: 0, lab_fact: 0, scan_fact: 0 },
    duplicateBusinessKeys: { visits: 0, drug_fact: 0, diagnosis_fact: 'UNKNOWN', lab_fact: 'UNKNOWN', scan_fact: 'UNKNOWN' },
    ...overrides,
  };
}

test('same bytes produce the exact same SHA-256 fingerprint; different bytes are new', () => {
  const first = fingerprintBuffer(Buffer.from('acute workbook'), 'acute.xlsx', '2026-08-26T00:00:00.000Z');
  const same = fingerprintBuffer(Buffer.from('acute workbook'), 'renamed.xlsx', '2026-08-26T00:00:00.000Z');
  const different = fingerprintBuffer(Buffer.from('different workbook'), 'acute.xlsx', '2026-08-26T00:00:00.000Z');
  assert.equal(first.fileHash, same.fileHash);
  assert.notEqual(first.fileHash, different.fileHash);
  assert.equal(first.fileSizeBytes, 14);
});

test('aggregate increase is PASS at the observed table level but exact row outcomes remain UNKNOWN', () => {
  const result = reconcileAcute(state(), state({ visitsTotal: 12, uniqueVisitIds: 12, drugRows: 12 }));
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.failures.length, 0);
  assert.equal(result.metrics.find((metric) => metric.tableName === 'visits')?.metrics.delta, 2);
  assert.equal(result.metrics.find((metric) => metric.tableName === 'visits')?.insertedCount, null);
  assert.ok(result.unknowns.some((message) => message.includes('Exact inserted')));
  assert.equal(isVerifiedReconciliation(result), false);
});

test('no change is a warning/unknown and decrease is FAIL', () => {
  const unchanged = reconcileAcute(state(), state());
  assert.equal(unchanged.status, 'UNKNOWN');
  assert.ok(unchanged.warnings.some((message) => message.includes('No visit-count change')));
  const decreased = reconcileAcute(state(), state({ visitsTotal: 9 }));
  assert.equal(decreased.status, 'FAIL');
  assert.ok(decreased.failures.some((message) => message.includes('visits row count decreased')));
  assert.equal(observationBatchStatus(decreased), 'FAILED');
  assert.equal(observationBatchStatus(unchanged), 'UNKNOWN');
});

test('legacy rows are not attributed and only an explicitly verified result can create a version', () => {
  const result = reconcileAcute(state(), state({ visitsTotal: 11 }));
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(isVerifiedReconciliation(result), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state(), 'patientRows'), false);
});

test('governance APIs are admin-gated and contain no patient-level response query', () => {
  const root = path.resolve(process.cwd());
  const routes = [
    'app/api/admin/import-history/route.ts',
    'app/api/admin/import-history/[id]/route.ts',
    'app/api/admin/import-governance/prepare/route.ts',
    'app/api/admin/import-governance/[id]/reconcile/route.ts',
  ];
  for (const route of routes) {
    const source = readFileSync(path.join(root, route), 'utf8');
    assert.match(source, /requireAdminApi/);
    assert.doesNotMatch(source, /select\s+[^;]*from\s+healpath\.(visits|patient_master)/is);
  }
});
