/**
 * Appointment export parsing, ported from the Capacity Analyser tool
 * (lines 361-389 and 747-820), with three deliberate changes.
 *
 * 1. Patient data never becomes a row object. The export carries patient name,
 *    mobile, MRN, gender, age, insurance provider, insured member, TPA and
 *    policy holder. Only the mapped indices of the eight capacity columns are
 *    read, so no object containing a patient ever exists in memory. Whatever
 *    was found and discarded is reported in `droppedColumns` so the person
 *    importing can see the firewall worked.
 * 2. The date order is pinned by the caller. The source tool guesses it from a
 *    400-row sample; a month whose sampled days are all 12 or lower flips
 *    silently to US order and misreads every date in the file.
 * 3. The per-appointment duration column is read. The source tool ignores it
 *    and derives minutes from its rules instead. They agree while every row is
 *    15 minutes, but the column is the better source once they diverge.
 */

import * as XLSX from 'xlsx';

import { normalizePersonName } from './names';
import { pad2 } from './shift-time';
import type {
  AppointmentPreview,
  DateOrder,
  ParsedAppointmentRow,
  ParsedAppointmentWorkbook,
  StatusBucket,
} from './types';

interface ColumnDef {
  key: string;
  want: string[];
}

/** The only columns read. Anything not listed here never reaches a row. */
const COLUMNS: ColumnDef[] = [
  { key: 'doctor', want: ['practitioner', 'doctor', 'physician', 'provider', 'consultant', 'طبيب'] },
  { key: 'when', want: ['appointment date', 'date', 'datetime', 'appointment time', 'slot time'] },
  { key: 'duration', want: ['appointment duration', 'duration', 'slot length', 'minutes'] },
  { key: 'status', want: ['appointment status', 'status', 'state'] },
  { key: 'type', want: ['appointment type', 'type', 'programme', 'program', 'service'] },
  { key: 'mode', want: ['appointment mode', 'mode', 'channel'] },
  { key: 'spec', want: ['speciality', 'specialty', 'specialisation', 'department', 'discipline', 'clinic', 'تخصص'] },
  { key: 'reason', want: ['cancelation reason', 'cancellation reason', 'reason'] },
];

/**
 * Headers that identify a patient or a payer. Matched only to report that they
 * were present and dropped - their indices are never read.
 */
const PHI_HEADER_RE =
  /patient\s*(name|mobile|mrn|id|gender|age)|^mrn$|mobile|phone|insur|insured|tpa|policy\s*holder|gate\s*keeper|appointment\s*id|national\s*id|passport/i;

/** Fold a raw status into one of the four states reported against capacity. */
export function statusBucket(status: unknown): StatusBucket {
  const value = String(status ?? '').toLowerCase();
  if (value.includes('complet')) return 'completed';
  if (value.includes('cancel')) return 'canceled';
  if (value.includes('no-show') || value.includes('no show') || value.includes('noshow')) return 'noshow';
  return 'other';
}

/**
 * Read a date/time cell. Accepts a Date, an Excel serial, an ISO string, and
 * the export's own "25/10/2026 - 09:45 PM". `order` decides which of the first
 * two numbers is the day and is never guessed here.
 */
export function parseWhen(
  value: unknown,
  order: DateOrder,
): { date: string; min: number | null } | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`,
      min: value.getHours() * 60 + value.getMinutes(),
    };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const utc = new Date(Math.round((value - 25569) * 86400000));
    const local = new Date(
      utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(),
      utc.getUTCHours(), utc.getUTCMinutes(),
    );
    return {
      date: `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`,
      min: local.getHours() * 60 + local.getMinutes(),
    };
  }

  const text = String(value).trim();

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(\d{1,2}):(\d{2}))?/);
  if (match) {
    return {
      date: `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`,
      min: match[4] != null ? Number(match[4]) * 60 + Number(match[5]) : null,
    };
  }

  match = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;

  let day = order === 'mdy' ? second : first;
  let month = order === 'mdy' ? first : second;
  // A value above 12 can only be a day, whichever order was declared.
  if (month > 12 && day <= 12) {
    const swap = day;
    day = month;
    month = swap;
  }

  const time = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([APap][Mm])?/);
  let min: number | null = null;
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2]);
    const suffix = time[3] ? time[3].toLowerCase() : null;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    min = hour * 60 + minute;
  }

  return { date: `${year}-${pad2(month)}-${pad2(day)}`, min };
}

/** Suggest a date order from sample values. Advisory only - never applied. */
export function detectDateOrder(samples: unknown[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const sample of samples) {
    const match = String(sample ?? '').match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst++;
    if (Number(match[2]) > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

function mapColumns(headerRow: unknown[]): { map: Record<string, number>; headers: string[] } {
  const headers = headerRow.map((cell) => String(cell == null ? '' : cell).toLowerCase().trim());
  const map: Record<string, number> = {};
  const used = new Set<number>();
  for (const column of COLUMNS) {
    let index = -1;
    for (const want of column.want) {
      index = headers.findIndex((header, i) => !used.has(i) && header === want);
      if (index >= 0) break;
    }
    if (index < 0) {
      for (const want of column.want) {
        index = headers.findIndex((header, i) => !used.has(i) && header.includes(want));
        if (index >= 0) break;
      }
    }
    if (index >= 0) {
      map[column.key] = index;
      used.add(index);
    }
  }
  return { map, headers };
}

const clean = (value: unknown) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

export function parseAppointmentWorkbook(
  input: ArrayBuffer | Uint8Array,
  options: { dateOrder: DateOrder; sheetName?: string; trace?: (message: string) => void },
): ParsedAppointmentWorkbook {
  const { dateOrder, trace } = options;
  trace?.('appointments: reading workbook');

  // Note: xlsx 0.18.5 has no `dense` option, so the whole sheet is materialised
  // as a cell map. At 64k rows x 24 columns that is the peak-memory step of the
  // whole import and must be measured on the real file before this ships.
  const workbook = XLSX.read(input instanceof Uint8Array ? input : new Uint8Array(input), {
    type: 'array',
  });

  const sheetName =
    options.sheetName && workbook.SheetNames.includes(options.sheetName)
      ? options.sheetName
      : workbook.SheetNames[0];
  if (!sheetName) {
    return emptyResult(dateOrder, ['The workbook has no sheets.']);
  }

  // header:1 keeps every row as an array, so a row object carrying patient
  // columns is never constructed.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });
  trace?.(`appointments: ${rows.length} raw row(s) on "${sheetName}"`);

  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const probe = mapColumns(rows[i] || []);
    if (probe.map.doctor != null && (probe.map.status != null || probe.map.when != null)) {
      headerIndex = i;
      break;
    }
  }

  const { map, headers } = mapColumns(rows[headerIndex] || []);
  if (map.doctor == null) {
    return emptyResult(dateOrder, [
      'No practitioner column was found on this sheet. Choose the sheet holding the raw appointment rows.',
    ]);
  }

  const droppedColumns = headers.filter((header) => header && PHI_HEADER_RE.test(header));

  const parsed: ParsedAppointmentRow[] = [];
  const durations: number[] = [];
  const statusCounts: Record<StatusBucket, number> = { completed: 0, canceled: 0, noshow: 0, other: 0 };
  const rawStatusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const dates = new Set<string>();
  const doctors = new Set<string>();
  const specialties = new Set<string>();
  let undatedRows = 0;
  let noDoctorRows = 0;

  const at = (row: unknown[], key: string) => (map[key] == null ? '' : clean(row[map[key]]));

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];

    const doctorText = at(row, 'doctor');
    if (!doctorText) {
      noDoctorRows++;
      continue;
    }

    const when = map.when != null ? parseWhen(row[map.when], dateOrder) : null;
    if (!when || !when.date) {
      undatedRows++;
      continue;
    }

    const statusRaw = at(row, 'status');
    const bucket = statusBucket(statusRaw);
    const apptType = at(row, 'type') || null;
    const specialtyText = at(row, 'spec') || null;

    const durationText = at(row, 'duration');
    const durationValue = durationText ? Number(durationText.replace(/[^0-9.]/g, '')) : NaN;
    const durationMin = Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null;
    if (durationMin != null) durations.push(durationMin);

    parsed.push({
      apptDate: when.date,
      startMin: when.min,
      durationMin,
      doctorText,
      doctorKey: normalizePersonName(doctorText),
      specialtyText,
      statusRaw,
      statusBucket: bucket,
      apptType,
      apptMode: at(row, 'mode') || null,
      cancelReason: at(row, 'reason') || null,
    });

    statusCounts[bucket]++;
    rawStatusCounts[statusRaw || '(blank)'] = (rawStatusCounts[statusRaw || '(blank)'] ?? 0) + 1;
    if (apptType) typeCounts[apptType] = (typeCounts[apptType] ?? 0) + 1;
    dates.add(when.date);
    doctors.add(normalizePersonName(doctorText));
    if (specialtyText) specialties.add(specialtyText);
  }

  const ordered = [...dates].sort();
  const sortedDurations = [...durations].sort((a, b) => a - b);

  const preview: AppointmentPreview = {
    totalRows: Math.max(0, rows.length - headerIndex - 1),
    parsedRows: parsed.length,
    undatedRows,
    noDoctorRows,
    coverageStart: ordered[0] ?? null,
    coverageEnd: ordered[ordered.length - 1] ?? null,
    datesCovered: ordered.length,
    distinctDoctors: doctors.size,
    distinctSpecialties: specialties.size,
    statusCounts,
    rawStatusCounts,
    typeCounts,
    durationColumnFound: map.duration != null,
    medianDurationMin: sortedDurations.length
      ? sortedDurations[Math.floor(sortedDurations.length / 2)]
      : null,
    detectedColumns: Object.fromEntries(
      COLUMNS.map((column) => [column.key, map[column.key] == null ? null : headers[map[column.key]]]),
    ),
    droppedColumns,
    dateOrder,
    dateOrderSource: 'pinned',
    errors: parsed.length ? [] : ['No dated appointments were found on this sheet.'],
  };

  trace?.(`appointments: ${parsed.length} row(s) parsed, ${droppedColumns.length} patient column(s) dropped`);
  return { rows: parsed, preview, errors: preview.errors };
}

function emptyResult(dateOrder: DateOrder, errors: string[]): ParsedAppointmentWorkbook {
  return {
    rows: [],
    preview: {
      totalRows: 0,
      parsedRows: 0,
      undatedRows: 0,
      noDoctorRows: 0,
      coverageStart: null,
      coverageEnd: null,
      datesCovered: 0,
      distinctDoctors: 0,
      distinctSpecialties: 0,
      statusCounts: { completed: 0, canceled: 0, noshow: 0, other: 0 },
      rawStatusCounts: {},
      typeCounts: {},
      durationColumnFound: false,
      medianDurationMin: null,
      detectedColumns: {},
      droppedColumns: [],
      dateOrder,
      dateOrderSource: 'pinned',
      errors,
    },
    errors,
  };
}
