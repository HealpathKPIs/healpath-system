import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildAnomalies,
  buildMonthlyReconciliation,
  buildQualityChecks,
  classifyQualityOperationalStatus,
  findMonthGaps,
  type AnomalyAggregateInput,
  type DataQualityAggregateInput,
  type MonthlyAggregate,
} from '../lib/data-quality';

const clean: DataQualityAggregateInput = {
  totalVisits: 100, distinctVisitIds: 100, duplicatePatientVisitPairs: 0,
  missingPatientIds: 0, missingDoctors: 0, missingSpecialties: 0, missingPrescriptionDates: 0, missingMonthYears: 0,
  dateMonthMismatches: 0, futureDatedVisits: 0, outsideReportingScope: 0, nullVisitKeys: 0,
  rawDoctorNames: 10, normalizedDoctorNames: 10, rawSpecialtyNames: 5, normalizedSpecialtyNames: 5,
  earliestPrescriptionDate: '2026-01-01', latestPrescriptionDate: '2026-02-28',
  facts: [
    { table: 'diagnosis_fact', rows: 100, distinctVisitIds: 80, nullVisitIds: 0, orphanRows: 0, nullBusinessKeys: 0 },
    { table: 'drug_fact', rows: 200, distinctVisitIds: 90, nullVisitIds: 0, orphanRows: 0, nullBusinessKeys: 0 },
    { table: 'lab_fact', rows: 50, distinctVisitIds: 40, nullVisitIds: 0, orphanRows: 0, nullBusinessKeys: 0 },
    { table: 'scan_fact', rows: 10, distinctVisitIds: 10, nullVisitIds: 0, orphanRows: 0, nullBusinessKeys: 0 },
  ],
};

const month: MonthlyAggregate = {
  month: '2026-01', totalVisits: 50, dashboardEligibleVisits: 50, uniquePatients: 40,
  uniqueDoctors: 8, uniqueSpecialties: 4, diagnosisRows: 50, drugRows: 100, labRows: 25, scanRows: 5,
};

const anomalyInput: AnomalyAggregateInput = {
  latestMonth: '2026-02', previousMonth: '2026-01', latestMonthVisits: 50, previousMonthVisits: 50,
  disappearedDoctors: 0, disappearedSpecialties: 0, monthGapCount: 0,
  factRatios: { diagnosis_fact: 1, drug_fact: 2 }, missingValuesCurrent: 0,
};

test('zero-count deterministic quality conditions are PASS', () => {
  const checks = buildQualityChecks(clean, []);
  assert.equal(checks.find((check) => check.checkName === 'Duplicate visit IDs')?.severity, 'PASS');
  assert.equal(checks.find((check) => check.checkName === 'Missing patient IDs')?.severity, 'PASS');
  assert.equal(checks.find((check) => check.checkName === 'Orphan drug rows')?.severity, 'PASS');
});

test('missing data and normalization variants are WARNING, not automatic errors', () => {
  const checks = buildQualityChecks({ ...clean, missingPatientIds: 3, missingDoctors: 2, rawDoctorNames: 12 }, []);
  assert.equal(checks.find((check) => check.checkName === 'Missing patient IDs')?.severity, 'WARNING');
  assert.equal(checks.find((check) => check.checkName === 'Missing doctor')?.severity, 'WARNING');
  assert.equal(checks.find((check) => check.checkName === 'Doctor-name normalization variants')?.currentValue, 2);
});

test('duplicate keys, date/month inconsistencies, and orphans are CRITICAL', () => {
  const checks = buildQualityChecks({
    ...clean, totalVisits: 102, dateMonthMismatches: 1,
    facts: clean.facts.map((fact) => fact.table === 'lab_fact' ? { ...fact, orphanRows: 2 } : fact),
  }, []);
  assert.equal(checks.find((check) => check.checkName === 'Duplicate visit IDs')?.severity, 'CRITICAL');
  assert.equal(checks.find((check) => check.checkName === 'Date/month inconsistencies')?.severity, 'CRITICAL');
  assert.equal(checks.find((check) => check.checkName === 'Orphan lab rows')?.severity, 'CRITICAL');
});

test('invalid-date business validity is UNKNOWN without an approved date range', () => {
  const check = buildQualityChecks(clean, []).find((item) => item.checkName === 'Invalid prescription dates');
  assert.equal(check?.severity, 'UNKNOWN');
  assert.equal(check?.baselineValue, null);
  assert.equal(check?.actionRequired, false);
});

test('month reconciliation reports actual values and UNKNOWN when no trusted baseline exists', () => {
  const result = buildMonthlyReconciliation([month], null)[0];
  assert.equal(result.totalVisits, 50);
  assert.equal(result.diagnosisRows, 50);
  assert.equal(result.baselineStatus, 'UNKNOWN / NO BASELINE');
  assert.equal(result.visitDifference, null);
});

test('verified monthly baseline comparison uses only supplied trusted aggregate values', () => {
  const result = buildMonthlyReconciliation([month], { '2026-01': 48 })[0];
  assert.equal(result.baselineStatus, 'VERIFIED BASELINE');
  assert.equal(result.baselineVisits, 48);
  assert.equal(result.visitDifference, 2);
});

test('calendar gaps are deterministic WARNING signals', () => {
  const gaps = findMonthGaps(['2026-01', '2026-03']);
  assert.deepEqual(gaps, ['2026-02']);
  const check = buildQualityChecks(clean, gaps).find((item) => item.checkName === 'Month gaps');
  assert.equal(check?.severity, 'WARNING');
});

test('unapproved volume, disappearance, ratio, and missing-value thresholds remain UNKNOWN', () => {
  const anomalies = buildAnomalies({ ...anomalyInput, latestMonthVisits: 1000, disappearedDoctors: 25, missingValuesCurrent: 500 });
  for (const name of ['Month-over-month visit volume change', 'Doctor volume disappearance', 'Fact-to-visit ratio anomaly', 'Sudden increase in missing values']) {
    assert.equal(anomalies.find((anomaly) => anomaly.checkName === name)?.severity, 'UNKNOWN');
  }
});

test('latest month outside configured scope is WARNING, not CRITICAL', () => {
  const anomaly = buildAnomalies({ ...anomalyInput, latestMonth: '2027-01' }).find((item) => item.checkName === 'Unexpected new reporting month');
  assert.equal(anomaly?.severity, 'WARNING');
  assert.equal(anomaly?.actionRequired, true);
});

test('UNKNOWN evidence keeps quality operational status DEGRADED rather than PASS', () => {
  const checks = buildQualityChecks(clean, []);
  const anomalies = buildAnomalies(anomalyInput);
  assert.equal(classifyQualityOperationalStatus(checks, anomalies), 'DEGRADED');
});

test('Data Quality API is admin-only, GET-only, non-cached, and aggregate-read-only', () => {
  const root = path.resolve(process.cwd());
  const route = readFileSync(path.join(root, 'app/api/admin/data-quality/route.ts'), 'utf8');
  const report = readFileSync(path.join(root, 'lib/data-quality-report.ts'), 'utf8');
  assert.match(route, /requireAdminApi/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /Cache-Control.*no-store/s);
  assert.doesNotMatch(route, /error\.message|String\(error\)/);
  assert.doesNotMatch(report, /\b(insert into|update healpath|delete from|upsert|alter table|create table)\b/i);
  assert.match(report, /Aggregate-only SELECT\/CTE queries/);
});
