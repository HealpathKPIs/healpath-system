import * as XLSX from 'xlsx';

export interface PatientMasterRow {
  patient_id: string;
  risk_carrier: string;
}

export interface PatientMasterValidationError {
  row: number;
  field: 'patient_id' | 'risk_carrier' | 'file';
  message: string;
  value?: string;
}

export interface PatientMasterParseResult {
  rows: PatientMasterRow[];
  errors: PatientMasterValidationError[];
  totalRows: number;
  skipped: number;
  headers: {
    patientId: string | null;
    riskCarrier: string | null;
  };
}

const BIGINT_MAX = BigInt('9223372036854775807');
const BIGINT_MIN = BigInt('-9223372036854775808');

function normalizeHeader(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function cellText(value: unknown) {
  return String(value ?? '').trim();
}

function isBlankRow(row: unknown[]) {
  return row.every((value) => cellText(value) === '');
}

function normalizePatientId(value: unknown): { value: string | null; reason?: string } {
  const raw = cellText(value);
  if (!raw) return { value: null, reason: 'Missing Patient ID.' };
  const normalized = raw.replace(/,/g, '').replace(/\.0$/, '');
  if (!/^-?\d+$/.test(normalized)) {
    return { value: null, reason: 'Patient ID must be a whole number.' };
  }
  const parsed = BigInt(normalized);
  if (parsed < BIGINT_MIN || parsed > BIGINT_MAX) {
    return { value: null, reason: 'Patient ID is outside the BIGINT range.' };
  }
  return { value: parsed.toString() };
}

export function parsePatientMasterWorkbook(buffer: Buffer): PatientMasterParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new Error('Invalid Excel file. Upload a valid .xlsx or .xls workbook.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      errors: [{ row: 0, field: 'file', message: 'The workbook is empty.' }],
      totalRows: 0,
      skipped: 0,
      headers: { patientId: null, riskCarrier: null },
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: '', raw: false });
  const headerIndex = grid.findIndex((row) => !isBlankRow(row));
  if (headerIndex < 0) {
    return {
      rows: [],
      errors: [{ row: 0, field: 'file', message: 'The workbook is empty.' }],
      totalRows: 0,
      skipped: 0,
      headers: { patientId: null, riskCarrier: null },
    };
  }

  const headers = grid[headerIndex].map(normalizeHeader);
  const patientIdIndex = headers.indexOf('INDIVIDUAL NUMBER');
  const riskCarrierIndex = headers.indexOf('RISK CARRIER');
  const errors: PatientMasterValidationError[] = [];

  if (patientIdIndex < 0) {
    errors.push({ row: headerIndex + 1, field: 'file', message: 'Missing required column: INDIVIDUAL NUMBER.' });
  }
  if (riskCarrierIndex < 0) {
    errors.push({ row: headerIndex + 1, field: 'file', message: 'Missing required column: Risk Carrier.' });
  }

  if (patientIdIndex < 0 || riskCarrierIndex < 0) {
    return {
      rows: [],
      errors,
      totalRows: Math.max(0, grid.length - headerIndex - 1),
      skipped: 0,
      headers: {
        patientId: patientIdIndex >= 0 ? String(grid[headerIndex][patientIdIndex] ?? '').trim() : null,
        riskCarrier: riskCarrierIndex >= 0 ? String(grid[headerIndex][riskCarrierIndex] ?? '').trim() : null,
      },
    };
  }

  const rows: PatientMasterRow[] = [];
  const seen = new Map<string, number[]>();
  let totalRows = 0;
  let skipped = 0;

  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const sourceRow = grid[index];
    if (isBlankRow(sourceRow)) {
      skipped += 1;
      continue;
    }

    totalRows += 1;
    const displayRow = index + 1;
    const patient = normalizePatientId(sourceRow[patientIdIndex]);
    const riskCarrier = cellText(sourceRow[riskCarrierIndex]);

    if (!patient.value) {
      errors.push({ row: displayRow, field: 'patient_id', message: patient.reason ?? 'Missing Patient ID.', value: cellText(sourceRow[patientIdIndex]) });
    }
    if (!riskCarrier) {
      errors.push({ row: displayRow, field: 'risk_carrier', message: 'Missing Risk Carrier.', value: cellText(sourceRow[riskCarrierIndex]) });
    }
    if (!patient.value || !riskCarrier) continue;

    rows.push({ patient_id: patient.value, risk_carrier: riskCarrier });
    const occurrences = seen.get(patient.value) ?? [];
    occurrences.push(displayRow);
    seen.set(patient.value, occurrences);
  }

  for (const [patientId, occurrences] of seen.entries()) {
    if (occurrences.length <= 1) continue;
    for (const row of occurrences) {
      errors.push({
        row,
        field: 'patient_id',
        message: `Duplicate Patient ID inside file: ${patientId}.`,
        value: patientId,
      });
    }
  }

  if (totalRows === 0) {
    errors.push({ row: 0, field: 'file', message: 'The workbook has headers but no Patient Master rows.' });
  }

  return {
    rows,
    errors,
    totalRows,
    skipped,
    headers: {
      patientId: String(grid[headerIndex][patientIdIndex] ?? '').trim(),
      riskCarrier: String(grid[headerIndex][riskCarrierIndex] ?? '').trim(),
    },
  };
}
