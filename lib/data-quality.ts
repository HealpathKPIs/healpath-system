export const REPORTING_SCOPE_PREFIX = '2026-';

export type QualitySeverity = 'PASS' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type QualityOperationalStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
export type QualitySource = 'LIVE' | 'CACHED' | 'MIXED' | 'UNAVAILABLE';

export interface FactQualityAggregate {
  table: 'diagnosis_fact' | 'drug_fact' | 'lab_fact' | 'scan_fact';
  rows: number;
  distinctVisitIds: number;
  nullVisitIds: number;
  orphanRows: number;
  nullBusinessKeys: number;
}

export interface DataQualityAggregateInput {
  totalVisits: number;
  distinctVisitIds: number;
  duplicatePatientVisitPairs: number;
  missingPatientIds: number;
  missingDoctors: number;
  missingSpecialties: number;
  missingPrescriptionDates: number;
  missingMonthYears: number;
  dateMonthMismatches: number;
  futureDatedVisits: number;
  outsideReportingScope: number;
  nullVisitKeys: number;
  rawDoctorNames: number;
  normalizedDoctorNames: number;
  rawSpecialtyNames: number;
  normalizedSpecialtyNames: number;
  earliestPrescriptionDate: string | null;
  latestPrescriptionDate: string | null;
  facts: FactQualityAggregate[];
}

export interface MonthlyAggregate {
  month: string;
  totalVisits: number;
  dashboardEligibleVisits: number;
  uniquePatients: number;
  uniqueDoctors: number;
  uniqueSpecialties: number;
  diagnosisRows: number;
  drugRows: number;
  labRows: number;
  scanRows: number;
}

export interface QualityCheck {
  severity: QualitySeverity;
  category: 'DATA COVERAGE' | 'DATA QUALITY' | 'FACT TABLE INTEGRITY';
  checkName: string;
  currentValue: number | string | null;
  baselineValue: number | string | null;
  difference: number | null;
  explanation: string;
  actionRequired: boolean;
}

export interface MonthlyReconciliationRow extends MonthlyAggregate {
  baselineStatus: 'VERIFIED BASELINE' | 'UNKNOWN / NO BASELINE';
  baselineVisits: number | null;
  visitDifference: number | null;
}

export interface AnomalyAggregateInput {
  latestMonth: string | null;
  previousMonth: string | null;
  latestMonthVisits: number | null;
  previousMonthVisits: number | null;
  disappearedDoctors: number | null;
  disappearedSpecialties: number | null;
  monthGapCount: number;
  factRatios: Record<string, number | null>;
  missingValuesCurrent: number;
}

export interface DataAnomaly {
  severity: QualitySeverity;
  checkName: string;
  currentValue: number | string | null;
  baselineValue: number | string | null;
  difference: number | null;
  rule: string;
  explanation: string;
  actionRequired: boolean;
}

export interface DataQualityReport {
  checkedAt: string;
  source: { source: QualitySource; operationalStatus: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' };
  qualityOperationalStatus: QualityOperationalStatus;
  reportingScope: string;
  checks: QualityCheck[];
  monthlyReconciliation: MonthlyReconciliationRow[];
  anomalies: DataAnomaly[];
  facts: FactQualityAggregate[];
  coverage: {
    earliestPrescriptionDate: string | null;
    latestPrescriptionDate: string | null;
    earliestReportingMonth: string | null;
    latestReportingMonth: string | null;
    monthGapCount: number;
  };
  knownLimitations: string[];
}

function zeroRule(input: {
  category: QualityCheck['category'];
  name: string;
  value: number;
  nonZeroSeverity: Extract<QualitySeverity, 'WARNING' | 'CRITICAL'>;
  explanation: string;
}): QualityCheck {
  return {
    severity: input.value === 0 ? 'PASS' : input.nonZeroSeverity,
    category: input.category,
    checkName: input.name,
    currentValue: input.value,
    baselineValue: 0,
    difference: input.value,
    explanation: input.explanation,
    actionRequired: input.value > 0,
  };
}

export function findMonthGaps(months: string[]): string[] {
  const valid = [...new Set(months.filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort();
  if (valid.length < 2) return [];
  const ordinal = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const format = (value: number) => `${Math.floor(value / 12).toString().padStart(4, '0')}-${String(value % 12 + 1).padStart(2, '0')}`;
  const present = new Set(valid);
  const gaps: string[] = [];
  for (let current = ordinal(valid[0]); current <= ordinal(valid.at(-1)!); current += 1) {
    const month = format(current);
    if (!present.has(month)) gaps.push(month);
  }
  return gaps;
}

export function buildQualityChecks(input: DataQualityAggregateInput, monthGaps: string[]): QualityCheck[] {
  const checks: QualityCheck[] = [
    zeroRule({ category: 'DATA QUALITY', name: 'Duplicate visit IDs', value: Math.max(0, input.totalVisits - input.distinctVisitIds), nonZeroSeverity: 'CRITICAL', explanation: 'Visit IDs are the existing visit primary key; any duplicate aggregate requires investigation.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Duplicate patient/visit combinations', value: input.duplicatePatientVisitPairs, nonZeroSeverity: 'CRITICAL', explanation: 'Counts repeated non-null patient/visit combinations without returning either identifier.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Missing patient IDs', value: input.missingPatientIds, nonZeroSeverity: 'WARNING', explanation: 'Counts visits whose patient ID is null. This is incomplete linkage, not proof that a record is lost.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Missing doctor', value: input.missingDoctors, nonZeroSeverity: 'WARNING', explanation: 'Counts visits with a null or blank practitioner name.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Missing specialty', value: input.missingSpecialties, nonZeroSeverity: 'WARNING', explanation: 'Counts visits with a null or blank doctor specialty.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Missing prescription date', value: input.missingPrescriptionDates, nonZeroSeverity: 'WARNING', explanation: 'Counts visits whose typed prescription timestamp is null.' }),
    {
      severity: 'UNKNOWN', category: 'DATA QUALITY', checkName: 'Invalid prescription dates', currentValue: null, baselineValue: null, difference: null,
      explanation: 'PostgreSQL guarantees timestamp syntax, but no approved business-valid date range exists. No date-range threshold is inferred.', actionRequired: false,
    },
    zeroRule({ category: 'DATA QUALITY', name: 'Missing month_year', value: input.missingMonthYears, nonZeroSeverity: 'WARNING', explanation: 'Counts visits with a null or blank reporting month.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Date/month inconsistencies', value: input.dateMonthMismatches, nonZeroSeverity: 'CRITICAL', explanation: 'Counts non-null dates whose YYYY-MM does not equal the stored reporting month.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Future-dated visits', value: input.futureDatedVisits, nonZeroSeverity: 'WARNING', explanation: 'Counts prescription timestamps later than the database clock at check time.' }),
    zeroRule({ category: 'DATA COVERAGE', name: 'Visits outside configured reporting scope', value: input.outsideReportingScope, nonZeroSeverity: 'WARNING', explanation: `Counts visits not mapped to the existing ${REPORTING_SCOPE_PREFIX}* reporting scope. These are outside scope, not missing.` }),
    zeroRule({ category: 'DATA QUALITY', name: 'Unexpected/null visit business keys', value: input.nullVisitKeys, nonZeroSeverity: 'CRITICAL', explanation: 'Counts null visit primary keys. The existing primary-key constraint normally prevents this.' }),
    zeroRule({ category: 'DATA COVERAGE', name: 'Month gaps', value: monthGaps.length, nonZeroSeverity: 'WARNING', explanation: 'Counts absent calendar months strictly between the earliest and latest valid reporting months.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Doctor-name normalization variants', value: Math.max(0, input.rawDoctorNames - input.normalizedDoctorNames), nonZeroSeverity: 'WARNING', explanation: 'Difference between raw distinct doctor names and lower/trim/space-normalized names; no data is corrected.' }),
    zeroRule({ category: 'DATA QUALITY', name: 'Specialty normalization variants', value: Math.max(0, input.rawSpecialtyNames - input.normalizedSpecialtyNames), nonZeroSeverity: 'WARNING', explanation: 'Difference between raw distinct specialties and lower/trim/space-normalized specialties; no data is corrected.' }),
  ];

  for (const fact of input.facts) {
    const label = fact.table.replace('_fact', '');
    checks.push(
      zeroRule({ category: 'FACT TABLE INTEGRITY', name: `Orphan ${label} rows`, value: fact.orphanRows, nonZeroSeverity: 'CRITICAL', explanation: `Counts ${fact.table} rows whose non-null visit key has no matching visit.` }),
      zeroRule({ category: 'FACT TABLE INTEGRITY', name: `Null ${label} visit keys`, value: fact.nullVisitIds, nonZeroSeverity: 'WARNING', explanation: `Counts ${fact.table} rows with a null visit key.` }),
      zeroRule({ category: 'FACT TABLE INTEGRITY', name: `Null/blank ${label} business keys`, value: fact.nullBusinessKeys, nonZeroSeverity: 'WARNING', explanation: `Counts ${fact.table} rows whose table-specific business value is null or blank.` }),
    );
  }
  return checks;
}

export function buildMonthlyReconciliation(rows: MonthlyAggregate[], baselineVisits: Record<string, number> | null): MonthlyReconciliationRow[] {
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((row) => {
    const baseline = baselineVisits && Object.prototype.hasOwnProperty.call(baselineVisits, row.month) ? Number(baselineVisits[row.month]) : null;
    return {
      ...row,
      baselineStatus: baseline === null ? 'UNKNOWN / NO BASELINE' as const : 'VERIFIED BASELINE' as const,
      baselineVisits: baseline,
      visitDifference: baseline === null ? null : row.totalVisits - baseline,
    };
  });
}

export function buildAnomalies(input: AnomalyAggregateInput): DataAnomaly[] {
  const volumeDifference = input.latestMonthVisits !== null && input.previousMonthVisits !== null
    ? input.latestMonthVisits - input.previousMonthVisits : null;
  const latestOutsideScope = input.latestMonth !== null && !input.latestMonth.startsWith(REPORTING_SCOPE_PREFIX);
  return [
    {
      severity: 'UNKNOWN', checkName: 'Month-over-month visit volume change', currentValue: input.latestMonthVisits,
      baselineValue: input.previousMonthVisits, difference: volumeDifference,
      rule: 'UNKNOWN unless an approved significant-change threshold is supplied.',
      explanation: 'The factual change is shown, but unusual volume is not automatically classified as bad data.', actionRequired: false,
    },
    {
      severity: 'UNKNOWN', checkName: 'Doctor volume disappearance', currentValue: input.disappearedDoctors,
      baselineValue: input.previousMonth, difference: null,
      rule: 'UNKNOWN because no approved disappearance threshold or trusted roster baseline exists.',
      explanation: 'Counts doctors present in the previous month and absent in the latest month without returning names.', actionRequired: false,
    },
    {
      severity: 'UNKNOWN', checkName: 'Specialty volume disappearance', currentValue: input.disappearedSpecialties,
      baselineValue: input.previousMonth, difference: null,
      rule: 'UNKNOWN because no approved disappearance threshold or trusted roster baseline exists.',
      explanation: 'Counts specialties present in the previous month and absent in the latest month without returning names.', actionRequired: false,
    },
    {
      severity: input.latestMonth === null ? 'UNKNOWN' : latestOutsideScope ? 'WARNING' : 'PASS', checkName: 'Unexpected new reporting month', currentValue: input.latestMonth,
      baselineValue: `${REPORTING_SCOPE_PREFIX}*`, difference: null,
      rule: `WARNING only when the latest valid reporting month is outside the configured ${REPORTING_SCOPE_PREFIX}* scope.`,
      explanation: 'This is a scope mismatch, not proof that the month is erroneous.', actionRequired: latestOutsideScope,
    },
    {
      severity: input.monthGapCount > 0 ? 'WARNING' : 'PASS', checkName: 'Unexpected data coverage gap', currentValue: input.monthGapCount,
      baselineValue: 0, difference: input.monthGapCount,
      rule: 'WARNING when one or more calendar months are absent between the earliest and latest valid reporting months.',
      explanation: 'A gap requires review but may reflect valid reporting coverage.', actionRequired: input.monthGapCount > 0,
    },
    {
      severity: 'UNKNOWN', checkName: 'Fact-to-visit ratio anomaly', currentValue: JSON.stringify(input.factRatios),
      baselineValue: null, difference: null,
      rule: 'UNKNOWN because no approved ratio threshold or trusted ratio baseline exists.',
      explanation: 'Current aggregate ratios are reported without declaring them anomalous.', actionRequired: false,
    },
    {
      severity: 'UNKNOWN', checkName: 'Sudden increase in missing values', currentValue: input.missingValuesCurrent,
      baselineValue: null, difference: null,
      rule: 'UNKNOWN because no trusted previous missing-value state or approved increase threshold exists.',
      explanation: 'The current aggregate count is factual; change cannot be inferred without a baseline.', actionRequired: false,
    },
  ];
}

export function classifyQualityOperationalStatus(checks: QualityCheck[], anomalies: DataAnomaly[]): QualityOperationalStatus {
  return [...checks, ...anomalies].every((item) => item.severity === 'PASS') ? 'HEALTHY' : 'DEGRADED';
}

export function unavailableDataQualityReport(checkedAt = new Date().toISOString()): DataQualityReport {
  return {
    checkedAt,
    source: { source: 'UNAVAILABLE', operationalStatus: 'UNAVAILABLE' },
    qualityOperationalStatus: 'UNAVAILABLE',
    reportingScope: `${REPORTING_SCOPE_PREFIX}*`, checks: [], monthlyReconciliation: [], anomalies: [], facts: [],
    coverage: { earliestPrescriptionDate: null, latestPrescriptionDate: null, earliestReportingMonth: null, latestReportingMonth: null, monthGapCount: 0 },
    knownLimitations: ['Aggregate data-quality checks are unavailable. No cached substitute is used for this view.'],
  };
}
