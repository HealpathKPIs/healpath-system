import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDataTrust, type DataTrustAssessmentInput } from '../lib/data-trust';
import { classifyDataSource } from '../lib/data-source';

const clean: DataTrustAssessmentInput = {
  duplicateVisitIds: 0,
  missingPatientIds: 0,
  missingPrescriptionDates: 0,
  missingMonthYears: 0,
  missingDoctors: 0,
  missingSpecialties: 0,
  dateMonthMismatches: 0,
  doctorNameVariants: 0,
  facts: [{ table: 'drug_fact', rows: 10, distinctVisitIds: 5, nullVisitIds: 0, orphanRows: 0 }],
};

test('clean aggregate integrity evidence is verified but overall provenance remains attention', () => {
  const result = assessDataTrust(clean);
  assert.equal(result.integrityStatus, 'verified');
  assert.equal(result.overallStatus, 'attention');
  assert.equal(result.hardFailures, 0);
  assert.equal(result.warnings, 0);
});

test('orphan and date/month violations are hard failures', () => {
  const result = assessDataTrust({
    ...clean,
    dateMonthMismatches: 2,
    facts: [{ ...clean.facts[0], orphanRows: 1 }],
  });
  assert.equal(result.integrityStatus, 'attention');
  assert.equal(result.hardFailures, 2);
});

test('missing values and doctor variants are warnings, not automatic corrections', () => {
  const result = assessDataTrust({ ...clean, missingPatientIds: 3, doctorNameVariants: 4 });
  assert.equal(result.hardFailures, 0);
  assert.equal(result.warnings, 2);
});

test('a page with both live and cached reads is explicitly mixed, never live', () => {
  assert.equal(classifyDataSource({
    hasDb: true,
    databaseReachable: true,
    liveQueries: 4,
    failureCount: 1,
    cachedReadCount: 1,
    unavailableReadCount: 0,
  }), 'mixed');
});

test('an uncovered required result makes the page unavailable', () => {
  assert.equal(classifyDataSource({
    hasDb: true,
    databaseReachable: true,
    liveQueries: 4,
    failureCount: 1,
    cachedReadCount: 0,
    unavailableReadCount: 1,
  }), 'unavailable');
});
