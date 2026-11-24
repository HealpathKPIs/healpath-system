import { dbHealthCheck, dbQuery } from '@/lib/pg';
import { getImportBatch, getImportGovernanceSummary } from '@/lib/import-governance';
import {
  REPORTING_SCOPE_PREFIX,
  buildAnomalies,
  buildMonthlyReconciliation,
  buildQualityChecks,
  classifyQualityOperationalStatus,
  findMonthGaps,
  unavailableDataQualityReport,
  type AnomalyAggregateInput,
  type DataQualityAggregateInput,
  type DataQualityReport,
  type FactQualityAggregate,
  type MonthlyAggregate,
} from '@/lib/data-quality';

type SummaryRow = Record<string, unknown>;

function number(row: SummaryRow, key: string) {
  return Number(row[key] ?? 0);
}

async function trustedMonthlyBaseline(): Promise<Record<string, number> | null> {
  try {
    const governance = await getImportGovernanceSummary();
    const batchId = governance.latestVerifiedVersion?.importBatchId;
    if (!governance.auditTablesAvailable || !batchId) return null;
    const batch = await getImportBatch(batchId);
    return batch?.afterState?.monthlyVisits ?? null;
  } catch {
    return null;
  }
}

/** Aggregate-only SELECT/CTE queries. No patient or visit identifiers are returned. */
export async function getDataQualityReport(): Promise<DataQualityReport> {
  const checkedAt = new Date().toISOString();
  const health = await dbHealthCheck();
  if (!health.reachable) return unavailableDataQualityReport(checkedAt);

  try {
    const [summaryRows, factRows, monthRows, disappearanceRows, baselineVisits] = await Promise.all([
      dbQuery<SummaryRow>(`
        select
          count(*)::int as total_visits,
          count(distinct visit_id)::int as distinct_visit_ids,
          (select count(*)::int from (
            select patient_id, visit_id from healpath.visits
            where patient_id is not null
            group by patient_id, visit_id having count(*) > 1
          ) duplicate_pairs) as duplicate_patient_visit_pairs,
          count(*) filter (where patient_id is null)::int as missing_patient_ids,
          count(*) filter (where practitioner_name is null or btrim(practitioner_name) = '')::int as missing_doctors,
          count(*) filter (where doctor_specialty is null or btrim(doctor_specialty) = '')::int as missing_specialties,
          count(*) filter (where prescription_date is null)::int as missing_prescription_dates,
          count(*) filter (where month_year is null or btrim(month_year) = '')::int as missing_month_years,
          count(*) filter (
            where prescription_date is not null and month_year ~ '^\\d{4}-\\d{2}$'
              and to_char(prescription_date, 'YYYY-MM') <> month_year
          )::int as date_month_mismatches,
          count(*) filter (where prescription_date > now())::int as future_dated_visits,
          count(*) filter (where not coalesce(month_year like '${REPORTING_SCOPE_PREFIX}%', false))::int as outside_reporting_scope,
          count(*) filter (where visit_id is null)::int as null_visit_keys,
          count(distinct practitioner_name) filter (where practitioner_name is not null and btrim(practitioner_name) <> '')::int as raw_doctor_names,
          count(distinct regexp_replace(lower(btrim(practitioner_name)), '\\s+', ' ', 'g'))
            filter (where practitioner_name is not null and btrim(practitioner_name) <> '')::int as normalized_doctor_names,
          count(distinct doctor_specialty) filter (where doctor_specialty is not null and btrim(doctor_specialty) <> '')::int as raw_specialty_names,
          count(distinct regexp_replace(lower(btrim(doctor_specialty)), '\\s+', ' ', 'g'))
            filter (where doctor_specialty is not null and btrim(doctor_specialty) <> '')::int as normalized_specialty_names,
          min(prescription_date)::text as earliest_prescription_date,
          max(prescription_date)::text as latest_prescription_date
        from healpath.visits
      `),
      dbQuery<{ table: FactQualityAggregate['table']; rows: number; distinctVisitIds: number; nullVisitIds: number; orphanRows: number; nullBusinessKeys: number }>(`
        select 'diagnosis_fact' as table, count(*)::int as rows,
          count(distinct f.visit_id)::int as "distinctVisitIds",
          count(*) filter (where f.visit_id is null)::int as "nullVisitIds",
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int as "orphanRows",
          count(*) filter (where f.diseases is null or btrim(f.diseases) = '')::int as "nullBusinessKeys"
        from healpath.diagnosis_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'drug_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int,
          count(*) filter (where f.medications is null or btrim(f.medications) = '')::int
        from healpath.drug_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'lab_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int,
          count(*) filter (where f.tests is null or btrim(f.tests) = '')::int
        from healpath.lab_fact f left join healpath.visits v on v.visit_id = f.visit_id
        union all
        select 'scan_fact', count(*)::int, count(distinct f.visit_id)::int,
          count(*) filter (where f.visit_id is null)::int,
          count(*) filter (where f.visit_id is not null and v.visit_id is null)::int,
          count(*) filter (where f.tests is null or btrim(f.tests) = '')::int
        from healpath.scan_fact f left join healpath.visits v on v.visit_id = f.visit_id
      `),
      dbQuery<MonthlyAggregate>(`
        with visit_months as (
          select month_year as month,
            count(*)::int as "totalVisits",
            count(*) filter (where month_year like '${REPORTING_SCOPE_PREFIX}%')::int as "dashboardEligibleVisits",
            count(distinct patient_id)::int as "uniquePatients",
            count(distinct practitioner_name)::int as "uniqueDoctors",
            count(distinct doctor_specialty)::int as "uniqueSpecialties"
          from healpath.visits
          where month_year ~ '^\\d{4}-\\d{2}$'
          group by month_year
        ),
        diagnosis as (select v.month_year as month, count(*)::int as rows from healpath.diagnosis_fact f join healpath.visits v on v.visit_id = f.visit_id where v.month_year ~ '^\\d{4}-\\d{2}$' group by v.month_year),
        drugs as (select v.month_year as month, count(*)::int as rows from healpath.drug_fact f join healpath.visits v on v.visit_id = f.visit_id where v.month_year ~ '^\\d{4}-\\d{2}$' group by v.month_year),
        labs as (select v.month_year as month, count(*)::int as rows from healpath.lab_fact f join healpath.visits v on v.visit_id = f.visit_id where v.month_year ~ '^\\d{4}-\\d{2}$' group by v.month_year),
        scans as (select v.month_year as month, count(*)::int as rows from healpath.scan_fact f join healpath.visits v on v.visit_id = f.visit_id where v.month_year ~ '^\\d{4}-\\d{2}$' group by v.month_year)
        select m.month, m."totalVisits", m."dashboardEligibleVisits", m."uniquePatients", m."uniqueDoctors", m."uniqueSpecialties",
          coalesce(diagnosis.rows, 0)::int as "diagnosisRows", coalesce(drugs.rows, 0)::int as "drugRows",
          coalesce(labs.rows, 0)::int as "labRows", coalesce(scans.rows, 0)::int as "scanRows"
        from visit_months m
        left join diagnosis using (month) left join drugs using (month) left join labs using (month) left join scans using (month)
        order by m.month
      `),
      dbQuery<{ latest_month: string | null; previous_month: string | null; disappeared_doctors: number | null; disappeared_specialties: number | null }>(`
        with months as (
          select distinct month_year as month from healpath.visits where month_year ~ '^\\d{4}-\\d{2}$'
        ), bounds as (
          select max(month) as latest_month, (array_agg(month order by month desc))[2] as previous_month from months
        ), previous_doctors as (
          select distinct regexp_replace(lower(btrim(v.practitioner_name)), '\\s+', ' ', 'g') as value
          from healpath.visits v cross join bounds b where v.month_year = b.previous_month and v.practitioner_name is not null and btrim(v.practitioner_name) <> ''
        ), latest_doctors as (
          select distinct regexp_replace(lower(btrim(v.practitioner_name)), '\\s+', ' ', 'g') as value
          from healpath.visits v cross join bounds b where v.month_year = b.latest_month and v.practitioner_name is not null and btrim(v.practitioner_name) <> ''
        ), previous_specialties as (
          select distinct regexp_replace(lower(btrim(v.doctor_specialty)), '\\s+', ' ', 'g') as value
          from healpath.visits v cross join bounds b where v.month_year = b.previous_month and v.doctor_specialty is not null and btrim(v.doctor_specialty) <> ''
        ), latest_specialties as (
          select distinct regexp_replace(lower(btrim(v.doctor_specialty)), '\\s+', ' ', 'g') as value
          from healpath.visits v cross join bounds b where v.month_year = b.latest_month and v.doctor_specialty is not null and btrim(v.doctor_specialty) <> ''
        )
        select b.latest_month, b.previous_month,
          case when b.previous_month is null then null else (select count(*)::int from previous_doctors p left join latest_doctors l using (value) where l.value is null) end as disappeared_doctors,
          case when b.previous_month is null then null else (select count(*)::int from previous_specialties p left join latest_specialties l using (value) where l.value is null) end as disappeared_specialties
        from bounds b
      `),
      trustedMonthlyBaseline(),
    ]);

    const summary = summaryRows[0] ?? {};
    const facts: FactQualityAggregate[] = factRows.map((fact) => ({
      table: fact.table,
      rows: Number(fact.rows),
      distinctVisitIds: Number(fact.distinctVisitIds),
      nullVisitIds: Number(fact.nullVisitIds),
      orphanRows: Number(fact.orphanRows),
      nullBusinessKeys: Number(fact.nullBusinessKeys),
    }));
    const months = monthRows.map((month) => ({
      month: month.month,
      totalVisits: Number(month.totalVisits), dashboardEligibleVisits: Number(month.dashboardEligibleVisits),
      uniquePatients: Number(month.uniquePatients), uniqueDoctors: Number(month.uniqueDoctors), uniqueSpecialties: Number(month.uniqueSpecialties),
      diagnosisRows: Number(month.diagnosisRows), drugRows: Number(month.drugRows), labRows: Number(month.labRows), scanRows: Number(month.scanRows),
    }));
    const gaps = findMonthGaps(months.map((month) => month.month));
    const aggregates: DataQualityAggregateInput = {
      totalVisits: number(summary, 'total_visits'), distinctVisitIds: number(summary, 'distinct_visit_ids'),
      duplicatePatientVisitPairs: number(summary, 'duplicate_patient_visit_pairs'), missingPatientIds: number(summary, 'missing_patient_ids'),
      missingDoctors: number(summary, 'missing_doctors'), missingSpecialties: number(summary, 'missing_specialties'),
      missingPrescriptionDates: number(summary, 'missing_prescription_dates'), missingMonthYears: number(summary, 'missing_month_years'),
      dateMonthMismatches: number(summary, 'date_month_mismatches'), futureDatedVisits: number(summary, 'future_dated_visits'),
      outsideReportingScope: number(summary, 'outside_reporting_scope'), nullVisitKeys: number(summary, 'null_visit_keys'),
      rawDoctorNames: number(summary, 'raw_doctor_names'), normalizedDoctorNames: number(summary, 'normalized_doctor_names'),
      rawSpecialtyNames: number(summary, 'raw_specialty_names'), normalizedSpecialtyNames: number(summary, 'normalized_specialty_names'),
      earliestPrescriptionDate: typeof summary.earliest_prescription_date === 'string' ? summary.earliest_prescription_date : null,
      latestPrescriptionDate: typeof summary.latest_prescription_date === 'string' ? summary.latest_prescription_date : null,
      facts,
    };
    const checks = buildQualityChecks(aggregates, gaps);
    const disappearance = disappearanceRows[0] ?? { latest_month: null, previous_month: null, disappeared_doctors: null, disappeared_specialties: null };
    const latest = months.find((month) => month.month === disappearance.latest_month) ?? null;
    const previous = months.find((month) => month.month === disappearance.previous_month) ?? null;
    const anomalyInput: AnomalyAggregateInput = {
      latestMonth: disappearance.latest_month, previousMonth: disappearance.previous_month,
      latestMonthVisits: latest?.totalVisits ?? null, previousMonthVisits: previous?.totalVisits ?? null,
      disappearedDoctors: disappearance.disappeared_doctors === null ? null : Number(disappearance.disappeared_doctors),
      disappearedSpecialties: disappearance.disappeared_specialties === null ? null : Number(disappearance.disappeared_specialties),
      monthGapCount: gaps.length,
      factRatios: Object.fromEntries(facts.map((fact) => [fact.table, aggregates.totalVisits ? Number((fact.rows / aggregates.totalVisits).toFixed(4)) : null])),
      missingValuesCurrent: aggregates.missingPatientIds + aggregates.missingDoctors + aggregates.missingSpecialties + aggregates.missingPrescriptionDates + aggregates.missingMonthYears,
    };
    const anomalies = buildAnomalies(anomalyInput);
    const monthlyReconciliation = buildMonthlyReconciliation(months, baselineVisits);
    return {
      checkedAt,
      source: { source: 'LIVE', operationalStatus: 'HEALTHY' },
      qualityOperationalStatus: classifyQualityOperationalStatus(checks, anomalies),
      reportingScope: `${REPORTING_SCOPE_PREFIX}*`, checks, monthlyReconciliation, anomalies, facts,
      coverage: {
        earliestPrescriptionDate: aggregates.earliestPrescriptionDate,
        latestPrescriptionDate: aggregates.latestPrescriptionDate,
        earliestReportingMonth: months[0]?.month ?? null,
        latestReportingMonth: months.at(-1)?.month ?? null,
        monthGapCount: gaps.length,
      },
      knownLimitations: [
        'Database reachability proves only that aggregate reads succeeded; it does not prove data correctness.',
        'Invalid-date business ranges, significant volume changes, disappearance thresholds, fact ratios, and missing-value increases remain UNKNOWN without approved thresholds or baselines.',
        'Monthly baseline comparison is used only when a VERIFIED governance data version points to an aggregate after-state containing monthly visits.',
        'Normalization checks report aggregate variant counts and do not identify, rename, merge, or correct records.',
        'All checks are aggregate observations. An anomaly is not automatically an error.',
      ],
    };
  } catch {
    return unavailableDataQualityReport(checkedAt);
  }
}
