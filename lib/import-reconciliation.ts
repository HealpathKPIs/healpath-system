import { dbQuery } from './pg';

export type ValidationStatus = 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN';

export interface ReconciliationState {
  capturedAt: string;
  visitsTotal: number;
  uniqueVisitIds: number;
  uniquePatients: number;
  dashboardEligibleVisits: number;
  outsideDashboardScope: number;
  diagnosisRows: number;
  drugRows: number;
  labRows: number;
  scanRows: number;
  earliestPrescriptionDate: string | null;
  latestPrescriptionDate: string | null;
  monthlyVisits: Record<string, number>;
  missingPatientIds: number;
  missingPrescriptionDates: number;
  missingMonthYears: number;
  missingDoctors: number;
  missingSpecialties: number;
  factOrphans: Record<string, number>;
  duplicateBusinessKeys: Record<string, number | 'UNKNOWN'>;
}

export interface ReconciliationMetric {
  tableName: string;
  rowsBefore: number | null;
  rowsAfter: number | null;
  distinctKeysBefore: number | null;
  distinctKeysAfter: number | null;
  insertedCount: number | null;
  updatedCount: number | null;
  unchangedCount: number | null;
  rejectedCount: number | null;
  orphanCount: number | null;
  validationStatus: ValidationStatus;
  metrics: Record<string, unknown>;
}

export interface ReconciliationResult {
  status: 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN';
  metrics: ReconciliationMetric[];
  unknowns: string[];
  warnings: string[];
  failures: string[];
}

export function isVerifiedReconciliation(result: ReconciliationResult) {
  return result.status === 'PASS' && result.unknowns.length === 0 && result.failures.length === 0;
}

export function observationBatchStatus(result: ReconciliationResult): 'FAILED' | 'UNKNOWN' {
  return result.failures.length ? 'FAILED' : 'UNKNOWN';
}

/** Fixed aggregate SELECTs only. This service never reads patient-level rows. */
export async function captureAcuteReconciliation(): Promise<ReconciliationState> {
  const [summaryRows, factRows, monthRows, drugDuplicateRows] = await Promise.all([
    dbQuery<Record<string, unknown>>(`
      select
        count(*)::int as visits_total,
        count(distinct visit_id)::int as unique_visit_ids,
        count(distinct patient_id)::int as unique_patients,
        count(*) filter (where month_year like '2026-%')::int as dashboard_eligible_visits,
        count(*) filter (where not coalesce(month_year like '2026-%', false))::int as outside_dashboard_scope,
        count(*) filter (where patient_id is null)::int as missing_patient_ids,
        count(*) filter (where prescription_date is null)::int as missing_prescription_dates,
        count(*) filter (where month_year is null or btrim(month_year) = '')::int as missing_month_years,
        count(*) filter (where practitioner_name is null or btrim(practitioner_name) = '')::int as missing_doctors,
        count(*) filter (where doctor_specialty is null or btrim(doctor_specialty) = '')::int as missing_specialties,
        min(prescription_date)::text as earliest_prescription_date,
        max(prescription_date)::text as latest_prescription_date
      from healpath.visits
    `),
    dbQuery<{ table_name: string; rows: number; unique_keys: number; orphan_count: number }>(`
      select 'diagnosis_fact' as table_name, count(*)::int as rows,
        count(distinct f.visit_id)::int as unique_keys,
        count(*) filter (where f.visit_id is not null and v.visit_id is null)::int as orphan_count
      from healpath.diagnosis_fact f left join healpath.visits v on v.visit_id = f.visit_id
      union all
      select 'drug_fact', count(*)::int, count(distinct f.visit_id)::int,
        count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
      from healpath.drug_fact f left join healpath.visits v on v.visit_id = f.visit_id
      union all
      select 'lab_fact', count(*)::int, count(distinct f.visit_id)::int,
        count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
      from healpath.lab_fact f left join healpath.visits v on v.visit_id = f.visit_id
      union all
      select 'scan_fact', count(*)::int, count(distinct f.visit_id)::int,
        count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
      from healpath.scan_fact f left join healpath.visits v on v.visit_id = f.visit_id
    `),
    dbQuery<{ month: string; visits: number }>(`
      select month_year as month, count(distinct visit_id)::int as visits
      from healpath.visits
      where month_year is not null and btrim(month_year) <> ''
      group by month_year order by month_year
    `),
    dbQuery<{ duplicate_keys: number }>(`
      select count(*)::int as duplicate_keys
      from (
        select visit_id, medications
        from healpath.drug_fact
        group by visit_id, medications
        having count(*) > 1
      ) duplicate_groups
    `),
  ]);

  const summary = summaryRows[0] ?? {};
  const facts = Object.fromEntries(factRows.map((row) => [row.table_name, row]));
  const number = (key: string) => Number(summary[key] ?? 0);
  return {
    capturedAt: new Date().toISOString(),
    visitsTotal: number('visits_total'),
    uniqueVisitIds: number('unique_visit_ids'),
    uniquePatients: number('unique_patients'),
    dashboardEligibleVisits: number('dashboard_eligible_visits'),
    outsideDashboardScope: number('outside_dashboard_scope'),
    diagnosisRows: Number(facts.diagnosis_fact?.rows ?? 0),
    drugRows: Number(facts.drug_fact?.rows ?? 0),
    labRows: Number(facts.lab_fact?.rows ?? 0),
    scanRows: Number(facts.scan_fact?.rows ?? 0),
    earliestPrescriptionDate: typeof summary.earliest_prescription_date === 'string' ? summary.earliest_prescription_date : null,
    latestPrescriptionDate: typeof summary.latest_prescription_date === 'string' ? summary.latest_prescription_date : null,
    monthlyVisits: Object.fromEntries(monthRows.map((row) => [row.month, Number(row.visits)])),
    missingPatientIds: number('missing_patient_ids'),
    missingPrescriptionDates: number('missing_prescription_dates'),
    missingMonthYears: number('missing_month_years'),
    missingDoctors: number('missing_doctors'),
    missingSpecialties: number('missing_specialties'),
    factOrphans: Object.fromEntries(factRows.map((row) => [row.table_name, Number(row.orphan_count)])),
    duplicateBusinessKeys: {
      visits: Math.max(0, number('visits_total') - number('unique_visit_ids')),
      drug_fact: Number(drugDuplicateRows[0]?.duplicate_keys ?? 0),
      diagnosis_fact: 'UNKNOWN',
      lab_fact: 'UNKNOWN',
      scan_fact: 'UNKNOWN',
    },
  };
}

function deltaStatus(before: number, after: number): ValidationStatus {
  return after < before ? 'FAIL' : 'PASS';
}

export function reconcileAcute(before: ReconciliationState, after: ReconciliationState): ReconciliationResult {
  const rows = [
    ['visits', before.visitsTotal, after.visitsTotal, before.uniqueVisitIds, after.uniqueVisitIds],
    ['diagnosis_fact', before.diagnosisRows, after.diagnosisRows, null, null],
    ['drug_fact', before.drugRows, after.drugRows, null, null],
    ['lab_fact', before.labRows, after.labRows, null, null],
    ['scan_fact', before.scanRows, after.scanRows, null, null],
  ] as const;
  const failures: string[] = [];
  const warnings: string[] = [];
  const unknowns = [
    'Exact inserted, updated, unchanged, and rejected counts are not observable without importer integration.',
    'Diagnosis, laboratory, and scan duplicate business keys are not defined by the existing system.',
  ];
  const metrics: ReconciliationMetric[] = rows.map(([tableName, rowsBefore, rowsAfter, distinctBefore, distinctAfter]) => {
    const validationStatus = deltaStatus(rowsBefore, rowsAfter);
    if (validationStatus === 'FAIL') failures.push(`${tableName} row count decreased.`);
    return {
      tableName,
      rowsBefore,
      rowsAfter,
      distinctKeysBefore: distinctBefore,
      distinctKeysAfter: distinctAfter,
      insertedCount: null,
      updatedCount: null,
      unchangedCount: null,
      rejectedCount: null,
      orphanCount: after.factOrphans[tableName] ?? null,
      validationStatus,
      metrics: { delta: rowsAfter - rowsBefore },
    };
  });
  if (before.visitsTotal === after.visitsTotal) warnings.push('No visit-count change was observed. The importer outcome cannot be inferred.');
  if (after.outsideDashboardScope > after.visitsTotal) failures.push('Outside-scope visits exceed total visits.');
  if (Object.values(after.factOrphans).some((count) => count > 0)) failures.push('Fact-table orphan rows are present after observation.');
  const status: ReconciliationResult['status'] = failures.length
    ? 'FAIL'
    : unknowns.length
      ? 'UNKNOWN'
      : warnings.length ? 'WARNING' : 'PASS';
  return { status, metrics, unknowns, warnings, failures };
}
