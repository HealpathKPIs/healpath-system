import { dbHealthCheck, dbQuery, hasDb } from './pg';
import { snapshotMeta } from './data-source';
import { getImportGovernanceSummary, type ImportGovernanceSummary } from './import-governance';
import { unavailableDataQualityReport, type DataQualityReport } from './data-quality';
import { getDataQualityReport } from './data-quality-report';

export interface FactIntegrityRow {
  table: string;
  rows: number;
  distinctVisitIds: number;
  nullVisitIds: number;
  orphanRows: number;
}

export interface DataTrustAssessmentInput {
  duplicateVisitIds: number;
  missingPatientIds: number;
  missingPrescriptionDates: number;
  missingMonthYears: number;
  missingDoctors: number;
  missingSpecialties: number;
  dateMonthMismatches: number;
  doctorNameVariants: number;
  facts: FactIntegrityRow[];
}

export function assessDataTrust(input: DataTrustAssessmentInput) {
  const hardFailures = [
    input.duplicateVisitIds,
    input.dateMonthMismatches,
    ...input.facts.flatMap((fact) => [fact.nullVisitIds, fact.orphanRows]),
  ].filter((count) => count > 0).length;
  const warnings = [
    input.missingPatientIds,
    input.missingPrescriptionDates,
    input.missingMonthYears,
    input.missingDoctors,
    input.missingSpecialties,
    input.doctorNameVariants,
  ].filter((count) => count > 0).length;

  return {
    integrityStatus: hardFailures > 0 ? 'attention' as const : 'verified' as const,
    overallStatus: 'attention' as const,
    hardFailures,
    warnings,
    limitation: 'Durable Acute import history is unavailable; browser-local history is not authoritative.',
  };
}

export interface DataTrustReport {
  checkedAt: string;
  database: { configured: boolean; reachable: boolean; latencyMs: number; error?: string };
  source: { source: 'LIVE' | 'UNAVAILABLE'; operationalStatus: 'HEALTHY' | 'UNAVAILABLE' };
  freshness: {
    earliestPrescriptionDate: string | null;
    latestPrescriptionDate: string | null;
    latestReportingMonth: string | null;
  };
  reconciliation: {
    visits: number;
    dashboardEligibleVisits: number;
    outsideDashboardScope: number;
    distinctVisitIds: number;
    duplicateVisitIds: number;
    distinctPatients: number;
    missingPatientIds: number;
    missingPrescriptionDates: number;
    missingMonthYears: number;
    missingDoctors: number;
    missingSpecialties: number;
    dateMonthMismatches: number;
    rawDoctorNames: number;
    normalizedDoctorNames: number;
    doctorNameVariants: number;
  };
  facts: FactIntegrityRow[];
  months: { month: string; visits: number }[];
  assessment: ReturnType<typeof assessDataTrust> | null;
  snapshot: (NonNullable<ReturnType<typeof snapshotMeta>> & { ageDays?: number | null }) | null;
  audit: { durableAcuteHistory: false; browserLocalHistoryKey: 'hp-upload-history' };
  governance: ImportGovernanceSummary;
  dataQuality: DataQualityReport;
}

const EMPTY_RECONCILIATION: DataTrustReport['reconciliation'] = {
  visits: 0,
  dashboardEligibleVisits: 0,
  outsideDashboardScope: 0,
  distinctVisitIds: 0,
  duplicateVisitIds: 0,
  distinctPatients: 0,
  missingPatientIds: 0,
  missingPrescriptionDates: 0,
  missingMonthYears: 0,
  missingDoctors: 0,
  missingSpecialties: 0,
  dateMonthMismatches: 0,
  rawDoctorNames: 0,
  normalizedDoctorNames: 0,
  doctorNameVariants: 0,
};

function snapshotWithAge(): DataTrustReport['snapshot'] {
  const meta = snapshotMeta();
  if (!meta) return null;
  const generated = meta.generatedAt ? Date.parse(meta.generatedAt) : Number.NaN;
  return {
    ...meta,
    ageDays: Number.isFinite(generated) ? Number(((Date.now() - generated) / 86_400_000).toFixed(1)) : null,
  };
}

/** Fixed aggregate SELECTs only. No patient-level rows or database mutations. */
export async function getDataTrustReport(): Promise<DataTrustReport> {
  const checkedAt = new Date().toISOString();
  const health = await dbHealthCheck();
  const base = {
    checkedAt,
    database: { configured: hasDb, ...health },
    snapshot: snapshotWithAge(),
    audit: { durableAcuteHistory: false as const, browserLocalHistoryKey: 'hp-upload-history' as const },
    governance: { auditTablesAvailable: false, latestImport: null, latestVerifiedVersion: null, latestReconciliation: null, unresolvedCount: 0 },
    dataQuality: unavailableDataQualityReport(checkedAt),
  };

  if (!health.reachable) {
    return {
      ...base,
      source: { source: 'UNAVAILABLE', operationalStatus: 'UNAVAILABLE' },
      freshness: { earliestPrescriptionDate: null, latestPrescriptionDate: null, latestReportingMonth: null },
      reconciliation: EMPTY_RECONCILIATION,
      facts: [],
      months: [],
      assessment: null,
    };
  }

  try {
    const [summaryRows, factRows, monthRows, governance, dataQuality] = await Promise.all([
      dbQuery<Record<string, unknown>>(`
        select
          count(*)::int as visits,
          count(distinct visit_id)::int as distinct_visit_ids,
          count(*) filter (where month_year like '2026-%')::int as dashboard_eligible_visits,
          count(*) filter (where not coalesce(month_year like '2026-%', false))::int as outside_dashboard_scope,
          count(distinct patient_id)::int as distinct_patients,
          count(*) filter (where patient_id is null)::int as missing_patient_ids,
          count(*) filter (where prescription_date is null)::int as missing_prescription_dates,
          count(*) filter (where month_year is null or btrim(month_year) = '')::int as missing_month_years,
          count(*) filter (where practitioner_name is null or btrim(practitioner_name) = '')::int as missing_doctors,
          count(*) filter (where doctor_specialty is null or btrim(doctor_specialty) = '')::int as missing_specialties,
          count(*) filter (
            where prescription_date is not null and month_year is not null
              and to_char(prescription_date, 'YYYY-MM') <> month_year
          )::int as date_month_mismatches,
          count(distinct practitioner_name) filter (where practitioner_name is not null and btrim(practitioner_name) <> '')::int as raw_doctor_names,
          count(distinct regexp_replace(lower(btrim(practitioner_name)), '\\s+', ' ', 'g'))
            filter (where practitioner_name is not null and btrim(practitioner_name) <> '')::int as normalized_doctor_names,
          min(prescription_date)::text as earliest_prescription_date,
          max(prescription_date)::text as latest_prescription_date,
          max(month_year) filter (where month_year ~ '^\\d{4}-\\d{2}$') as latest_reporting_month
        from healpath.visits
      `),
      dbQuery<FactIntegrityRow>(`
        select 'diagnosis_fact' as table, count(*)::int as rows,
          count(distinct f.visit_id)::int as "distinctVisitIds",
          count(*) filter (where f.visit_id is null)::int as "nullVisitIds",
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int as "orphanRows"
        from healpath.diagnosis_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'drug_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
        from healpath.drug_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'lab_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
        from healpath.lab_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'scan_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int
        from healpath.scan_fact f left join healpath.visits v on v.visit_id = f.visit_id
      `),
      dbQuery<{ month: string; visits: number }>(`
        select month_year as month, count(distinct visit_id)::int as visits
        from healpath.visits
        where month_year is not null and btrim(month_year) <> ''
        group by month_year
        order by month_year
      `),
      getImportGovernanceSummary().catch(() => ({ auditTablesAvailable: false, latestImport: null, latestVerifiedVersion: null, latestReconciliation: null, unresolvedCount: 0 })),
      getDataQualityReport(),
    ]);

    const row = summaryRows[0] ?? {};
    const visits = Number(row.visits ?? 0);
    const distinctVisitIds = Number(row.distinct_visit_ids ?? 0);
    const rawDoctorNames = Number(row.raw_doctor_names ?? 0);
    const normalizedDoctorNames = Number(row.normalized_doctor_names ?? 0);
    const reconciliation: DataTrustReport['reconciliation'] = {
      visits,
      dashboardEligibleVisits: Number(row.dashboard_eligible_visits ?? 0),
      outsideDashboardScope: Number(row.outside_dashboard_scope ?? 0),
      distinctVisitIds,
      duplicateVisitIds: Math.max(0, visits - distinctVisitIds),
      distinctPatients: Number(row.distinct_patients ?? 0),
      missingPatientIds: Number(row.missing_patient_ids ?? 0),
      missingPrescriptionDates: Number(row.missing_prescription_dates ?? 0),
      missingMonthYears: Number(row.missing_month_years ?? 0),
      missingDoctors: Number(row.missing_doctors ?? 0),
      missingSpecialties: Number(row.missing_specialties ?? 0),
      dateMonthMismatches: Number(row.date_month_mismatches ?? 0),
      rawDoctorNames,
      normalizedDoctorNames,
      doctorNameVariants: Math.max(0, rawDoctorNames - normalizedDoctorNames),
    };
    const facts = factRows.map((fact) => ({
      table: fact.table,
      rows: Number(fact.rows),
      distinctVisitIds: Number(fact.distinctVisitIds),
      nullVisitIds: Number(fact.nullVisitIds),
      orphanRows: Number(fact.orphanRows),
    }));

    return {
      ...base,
      source: { source: 'LIVE', operationalStatus: 'HEALTHY' },
      freshness: {
        earliestPrescriptionDate: typeof row.earliest_prescription_date === 'string' ? row.earliest_prescription_date : null,
        latestPrescriptionDate: typeof row.latest_prescription_date === 'string' ? row.latest_prescription_date : null,
        latestReportingMonth: typeof row.latest_reporting_month === 'string' ? row.latest_reporting_month : null,
      },
      reconciliation,
      facts,
      months: monthRows.map((month) => ({ month: month.month, visits: Number(month.visits) })),
      assessment: assessDataTrust({
        duplicateVisitIds: reconciliation.duplicateVisitIds,
        missingPatientIds: reconciliation.missingPatientIds,
        missingPrescriptionDates: reconciliation.missingPrescriptionDates,
        missingMonthYears: reconciliation.missingMonthYears,
        missingDoctors: reconciliation.missingDoctors,
        missingSpecialties: reconciliation.missingSpecialties,
        dateMonthMismatches: reconciliation.dateMonthMismatches,
        doctorNameVariants: reconciliation.doctorNameVariants,
        facts,
      }),
      governance,
      dataQuality,
    };
  } catch (error) {
    return {
      ...base,
      database: { ...base.database, reachable: false, error: error instanceof Error ? error.message : String(error) },
      source: { source: 'UNAVAILABLE', operationalStatus: 'UNAVAILABLE' },
      freshness: { earliestPrescriptionDate: null, latestPrescriptionDate: null, latestReportingMonth: null },
      reconciliation: EMPTY_RECONCILIATION,
      facts: [],
      months: [],
      assessment: null,
    };
  }
}
