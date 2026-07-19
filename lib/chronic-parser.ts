import * as XLSX from 'xlsx';
import {
  type ChronicCalendarEntry,
  chronicDetectedPeriodsLabel,
  chronicWeekNumber,
} from './chronic-calendar';

export type ChronicSheetName = 'Pre' | 'Post';
type RequiredKey = 'patient' | 'week' | 'recommendation';

export interface ChronicDetectedColumns {
  patient: string | null;
  week: string | null;
  recommendation: string | null;
  issues: string[];
  medication: string | null;
}

export interface ChronicSheetPreview {
  rows: number;
  patients: number;
  week: string;
  periods: string;
  recommendationCount: number;
  issueCount: number;
  medicationCount: number;
  detectedColumns: ChronicDetectedColumns;
  requiredColumns: boolean;
  errors: string[];
}

export interface ChronicParsedRow {
  batch_id: string;
  week: string;
  month: string;
  month_name: string;
  month_order: number;
  year: number;
  period: string;
  patient_id: string;
  recommendation: string;
  issue: string | null;
  medication_name: string;
  row_data: Record<string, unknown>;
}

export type ChronicPreview = Record<ChronicSheetName, ChronicSheetPreview>;
export type ChronicParsedWorkbookRows = Record<ChronicSheetName, ChronicParsedRow[]>;

export interface ChronicWorkbookValidation {
  requiredColumns: boolean;
  weekDetected: boolean;
  ready: boolean;
  errors: string[];
}

export interface ChronicWorkbook {
  parsed: ChronicParsedWorkbookRows;
  preview: ChronicPreview;
  validation: ChronicWorkbookValidation;
  errors: string[];
}

export const CHRONIC_SHEETS: ChronicSheetName[] = ['Pre', 'Post'];

const REQUIRED: RequiredKey[] = ['patient', 'week', 'recommendation'];
const REQUIRED_LABELS: Record<RequiredKey | 'issues', string> = {
  patient: 'Patient ID',
  week: 'Week',
  recommendation: 'Recommendation',
  issues: 'Issues',
};

const ALIASES: Record<RequiredKey, string[]> = {
  patient: [
    'individualnumber',
    'individualnbr',
    'individualno',
    'patientid',
    'id',
    'patient',
    'patientno',
    'patientnumber',
    'member',
    'memberid',
  ],
  week: ['week', 'weekno', 'weeknumber', 'reportingweek', 'period'],
  recommendation: ['recommendation', 'recommendations', 'recommendationcount', 'recommendationscount'],
};

const OPTIONAL_ALIASES = {
  medication: [
    'medicationname',
    'medication',
    'medications',
    'medicationcount',
    'medicationscount',
    'medicine',
    'medicinename',
    'drug',
    'drugname',
  ],
};

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPresent(value: unknown) {
  return value != null && String(value).trim() !== '';
}

function isIssueHeader(header: string) {
  return normalizeHeader(header).startsWith('issue');
}

export function detectColumns(headers: string[]): ChronicDetectedColumns {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const required = Object.fromEntries(
    REQUIRED.map((key) => [
      key,
      ALIASES[key].map(normalizeHeader).map((alias) => normalized.get(alias)).find(Boolean) ?? null,
    ]),
  ) as Record<RequiredKey, string | null>;

  return {
    ...required,
    issues: headers.filter(isIssueHeader),
    medication: OPTIONAL_ALIASES.medication
      .map(normalizeHeader)
      .map((alias) => normalized.get(alias))
      .find(Boolean) ?? null,
  };
}

function countValues(rows: Record<string, unknown>[], column: string) {
  return rows.reduce((sum, record) => {
    const value = record[column];
    if (!isPresent(value)) return sum;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numeric) && numeric > 0 ? sum + numeric : sum + 1;
  }, 0);
}

function countAcrossColumns(rows: Record<string, unknown>[], columns: string[]) {
  return rows.reduce((sum, record) => (
    sum + columns.reduce((inner, column) => {
      const value = record[column];
      if (!isPresent(value)) return inner;
      const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
      return inner + (Number.isFinite(numeric) && numeric > 0 ? numeric : 1);
    }, 0)
  ), 0);
}

function issueSummary(record: Record<string, unknown>, issueColumns: string[]) {
  const issues = issueColumns
    .map((column) => {
      const value = String(record[column] ?? '').trim();
      return value ? `${column}: ${value}` : '';
    })
    .filter(Boolean);
  return issues.length ? issues.join('; ') : null;
}

function missingSheetPreview(sheet: ChronicSheetName): ChronicSheetPreview {
  return {
    rows: 0,
    patients: 0,
    week: 'Not detected',
    periods: 'Not detected',
    recommendationCount: 0,
    issueCount: 0,
    medicationCount: 0,
    detectedColumns: { patient: null, week: null, recommendation: null, issues: [], medication: null },
    requiredColumns: false,
    errors: [`${sheet} sheet was not found.`],
  };
}

function parseSheet(sheet: ChronicSheetName, rows: Record<string, unknown>[], calendar: ChronicCalendarEntry[]): {
  parsed: ChronicParsedRow[];
  preview: ChronicSheetPreview;
} {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const detectedColumns = detectColumns(headers);
  const errors: string[] = [];

  const missing = [
    ...REQUIRED.filter((key) => !detectedColumns[key]).map((key) => REQUIRED_LABELS[key]),
    ...(detectedColumns.issues.length ? [] : [REQUIRED_LABELS.issues]),
  ];
  const requiredColumns = missing.length === 0;
  if (!requiredColumns) errors.push(`${sheet} sheet is missing required column(s): ${missing.join(', ')}.`);

  const patientSet = new Set(rows.map((record) => String(record[detectedColumns.patient ?? ''] ?? '').trim()).filter(Boolean));
  const weeks = Array.from(new Set(rows.map((record) => String(record[detectedColumns.week ?? ''] ?? '').trim()).filter(Boolean)));
  const parsed: ChronicParsedRow[] = [];

  if (requiredColumns) {
    const typedColumns = detectedColumns as ChronicDetectedColumns & Record<RequiredKey, string>;
    rows.forEach((record, index) => {
      const week = String(record[typedColumns.week] ?? '').trim();
      const patientId = String(record[typedColumns.patient] ?? '').trim();
      const recommendation = String(record[typedColumns.recommendation] ?? '').trim();
      const medicationName = detectedColumns.medication ? String(record[detectedColumns.medication] ?? '').trim() : '';

      if (!week) errors.push(`${sheet} row ${index + 2}: Week missing.`);
      if (!patientId) errors.push(`${sheet} row ${index + 2}: Patient ID missing.`);
      if (!recommendation) errors.push(`${sheet} row ${index + 2}: Recommendation missing.`);
      if (!week || !patientId || !recommendation) return;

      if (chronicWeekNumber(week) == null) {
        errors.push(`${sheet} row ${index + 2}: Week must be a positive number.`);
        return;
      }

      parsed.push({
        batch_id: '',
        week,
        month: '',
        month_name: '',
        month_order: 0,
        year: 0,
        period: '',
        patient_id: patientId,
        recommendation,
        issue: issueSummary(record, detectedColumns.issues),
        medication_name: medicationName,
        row_data: record,
      });
    });
  }

  return {
    parsed,
    preview: {
      rows: rows.length,
      patients: patientSet.size,
      week: weeks.length === 1 ? weeks[0] : weeks.length > 1 ? 'Multiple weeks' : 'Not detected',
      periods: chronicDetectedPeriodsLabel(calendar, weeks),
      recommendationCount: detectedColumns.recommendation ? countValues(rows, detectedColumns.recommendation) : 0,
      issueCount: countAcrossColumns(rows, detectedColumns.issues),
      medicationCount: detectedColumns.medication ? countValues(rows, detectedColumns.medication) : 0,
      detectedColumns,
      requiredColumns,
      errors,
    },
  };
}

export function validateWorkbook(preview: ChronicPreview | null): ChronicWorkbookValidation {
  const sheetPreviews = preview ? Object.values(preview) : [];
  const errors = sheetPreviews.flatMap((sheetPreview) => sheetPreview.errors);
  const requiredColumns = sheetPreviews.length === CHRONIC_SHEETS.length
    && sheetPreviews.every((sheetPreview) => sheetPreview.requiredColumns);
  const weekDetected = sheetPreviews.length === CHRONIC_SHEETS.length
    && sheetPreviews.every((sheetPreview) => Boolean(sheetPreview.detectedColumns.week));
  const ready = requiredColumns && weekDetected && errors.length === 0;
  return { requiredColumns, weekDetected, ready, errors };
}

export function parseWorkbook(
  input: ArrayBuffer | Uint8Array,
  calendar: ChronicCalendarEntry[] = [],
  // Optional trace hook (Sprint 33.5H2 hang diagnosis) — no-op unless provided.
  trace?: (message: string) => void,
): ChronicWorkbook {
  trace?.('4. XLSX.read started');
  const workbook = XLSX.read(input, { type: input instanceof ArrayBuffer ? 'array' : 'buffer' });
  trace?.('5. XLSX.read finished');
  const sheetMap = new Map(workbook.SheetNames.map((name) => [name.trim().toLowerCase(), name]));
  const parsed = { Pre: [], Post: [] } as ChronicParsedWorkbookRows;
  const preview = {} as ChronicPreview;

  for (const sheet of CHRONIC_SHEETS) {
    const actualName = sheetMap.get(sheet.toLowerCase());
    if (!actualName) {
      preview[sheet] = missingSheetPreview(sheet);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[actualName], { defval: '' });
    const parsedSheet = parseSheet(sheet, rows, calendar);
    parsed[sheet] = parsedSheet.parsed;
    preview[sheet] = parsedSheet.preview;
  }

  const validation = validateWorkbook(preview);
  return { parsed, preview, validation, errors: validation.errors };
}
