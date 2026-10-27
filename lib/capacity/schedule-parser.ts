/**
 * Schedule workbook parsing, ported from the Capacity Analyser tool
 * (lines 575-742).
 *
 * One workbook holds one month, one sheet per day ("Thu 01 Oct"). Each sheet has
 * a title, a header row, then doctor rows, then sections for doctors on leave
 * and doctors off. Rows that are really totals or repeated headers are layout,
 * not people, and must not become capacity.
 */

import * as XLSX from 'xlsx';

import { normalizePersonName } from './names';
import {
  isoDate,
  nextDay,
  pad2,
  parseClock,
  parseShiftText,
  prettyDate,
  shiftMinutes,
} from './shift-time';
import type {
  CapacityIssue,
  LeaveKind,
  ParsedLeaveRow,
  ParsedScheduleWorkbook,
  ParsedShiftRow,
  SchedulePreview,
} from './types';

type SheetRows = unknown[][];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Rows that are part of the sheet's layout rather than a doctor. */
const SUMMARY_RE =
  /^(doctors?|physicians?|staff)(\s+(on\s+duty|working|count|rostered|total))?$|^(grand\s+|sub\s*)?totals?\b|^count$|^sum$|^#$/i;
const HEADER_RE = /^(doctor|doctor name|doctors|physician|practitioner|name)$/i;

/** A note in the working list saying the doctor is away that day. */
const LEAVE_NOTE_RE =
  /^(annual|sick|casual|emergency|maternity|paternity|unpaid|study)\s+leave\b|^on leave\b|^leave$|^absent\b|^day off\b|^vacation\b/i;

const SKIP_SHEET_RE = /^(instructions?|readme|lists?|legend|notes?|sheet\d*|summary)$/i;

/**
 * Words that mean a captured phrase is the sheet's title, not a specialty.
 *
 * The source tool's fallback regex matches "Specialties Clinic Schedule —
 * Thursday, 1 October 2026" and assigns "Specialties Clinic Schedule" as the
 * specialty of every row whose own cell is blank. That is a real defect, so the
 * fallback is rejected here and whatever it picked is surfaced in the preview.
 */
const TITLE_NOT_SPECIALTY_RE = /\b(schedule|clinic|specialit|specialt|roster|timetable|rota)\b/i;

const text = (value: unknown) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

/** Which section of the sheet a heading introduces. */
function sectionOf(value: unknown): 'leave' | 'off' | 'work' | null {
  const t = String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t.length > 45) return null;
  if (/\bon leave\b|^leave\b|\bleaves?( today)?$|\bvacation\b|\babsent\b|\bnot worked\b/.test(t)) return 'leave';
  if (/^(off|day off|days off|off today|off duty|not working|not on duty|not rostered)\b/.test(t)) return 'off';
  if (/^(on duty|working|working today|on shift|rostered)\b/.test(t)) return 'work';
  return null;
}

/** Read the date a sheet covers, from its title text or its tab name. */
function sheetDate(
  tabName: string,
  titleText: string,
  fallbackYear: number | null,
  fallbackMonth: number | null,
): string | null {
  const hay = `${titleText} ${tabName}`;
  let match = hay.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (match) return `${match[3]}-${pad2(MONTHS[match[2].toLowerCase().slice(0, 3)])}-${pad2(Number(match[1]))}`;

  match = hay.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];

  match = tabName.match(/^\s*(\d{1,2})[\s\-_]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?/i);
  if (match) {
    const day = Number(match[1]);
    const month = match[2] ? MONTHS[match[2].toLowerCase().slice(0, 3)] : fallbackMonth;
    if (month && day >= 1 && day <= 31 && fallbackYear) {
      return `${fallbackYear}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return null;
}

type HeaderKey = 'doctor' | 'spec' | 'from' | 'to' | 'shifts' | 'clinic' | 'note' | 'hours';

const HEADER_WANT: Record<HeaderKey, string[]> = {
  doctor: ['doctor name', 'doctor', 'physician', 'practitioner', 'name'],
  spec: ['specialty', 'speciality', 'department'],
  from: ['from', 'start time', 'start'],
  to: ['to', 'end time', 'end'],
  shifts: ['shift(s)', 'shifts', 'shift', 'times', 'time', 'working hours'],
  clinic: ['clinic?', 'clinic'],
  note: ['note', 'notes', 'remarks', 'remark', 'comment', 'leave'],
  hours: ['hours', 'hrs', 'total hours'],
};

/** Locate the header row and map each known column to its index. */
function findHeader(rows: SheetRows): { row: number; map: Partial<Record<HeaderKey, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const headers = (rows[i] || []).map((cell) => String(cell == null ? '' : cell).toLowerCase().trim());
    const map: Partial<Record<HeaderKey, number>> = {};
    const used = new Set<number>();
    (Object.keys(HEADER_WANT) as HeaderKey[]).forEach((key) => {
      let index = -1;
      for (const want of HEADER_WANT[key]) {
        index = headers.findIndex((header, j) => !used.has(j) && header === want);
        if (index >= 0) break;
      }
      if (index < 0) {
        for (const want of HEADER_WANT[key]) {
          index = headers.findIndex((header, j) => !used.has(j) && header.includes(want));
          if (index >= 0) break;
        }
      }
      if (index >= 0) {
        map[key] = index;
        used.add(index);
      }
    });
    if (map.doctor != null && (map.shifts != null || map.from != null)) return { row: i, map };
  }
  return null;
}

interface CarriedShift {
  fromDate: string;
  date: string;
  doctorText: string;
  specialtyText: string | null;
  shift: [number, number];
  sheet: string;
  row: number;
}

export function parseScheduleWorkbook(
  input: ArrayBuffer | Uint8Array,
  trace?: (message: string) => void,
): ParsedScheduleWorkbook {
  trace?.('schedule: reading workbook');
  const workbook = XLSX.read(input instanceof Uint8Array ? input : new Uint8Array(input), {
    type: 'array',
  });

  const sheets = new Map<string, SheetRows>();
  for (const name of workbook.SheetNames) {
    sheets.set(
      name,
      XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
        header: 1,
        defval: '',
        blankrows: true,
        raw: false,
      }),
    );
  }
  trace?.(`schedule: ${sheets.size} sheet(s) read`);

  const titleTextOf = (rows: SheetRows) =>
    text([...(rows[0] || []), ...(rows[1] || [])].join(' '));

  // A fallback year/month, so a tab named only "01 Oct" still resolves.
  let fallbackYear: number | null = null;
  let fallbackMonth: number | null = null;
  for (const [name, rows] of sheets) {
    const resolved = sheetDate(name, titleTextOf(rows), null, null);
    if (resolved) {
      fallbackYear = Number(resolved.slice(0, 4));
      fallbackMonth = Number(resolved.slice(5, 7));
      break;
    }
  }

  // Fallback specialty for rows with a blank cell - only when it is plausibly a
  // specialty and not the sheet title. See TITLE_NOT_SPECIALTY_RE.
  let defaultSpecialty: string | null = null;
  let rejectedDefaultSpecialty: string | null = null;
  for (const rows of sheets.values()) {
    const first = String((rows[0] || [])[0] ?? '');
    const match = first.match(/^([A-Za-z .&/]+?)\s*[-–—]\s*\w+day/);
    if (!match) continue;
    const candidate = match[1].trim();
    if (TITLE_NOT_SPECIALTY_RE.test(candidate)) {
      rejectedDefaultSpecialty = candidate;
    } else {
      defaultSpecialty = candidate;
    }
    break;
  }

  const shifts: ParsedShiftRow[] = [];
  const leave: ParsedLeaveRow[] = [];
  const issues: CapacityIssue[] = [];
  const carried: CarriedShift[] = [];
  const sheetsSkipped: string[] = [];
  const datesSeen = new Set<string>();
  let sheetsRead = 0;
  let defaultSpecialtyUsed = false;

  for (const [tabName, rows] of sheets) {
    if (SKIP_SHEET_RE.test(tabName.trim())) {
      sheetsSkipped.push(tabName);
      continue;
    }
    const header = findHeader(rows);
    if (!header) {
      sheetsSkipped.push(tabName);
      continue;
    }
    const date = sheetDate(tabName, titleTextOf(rows), fallbackYear, fallbackMonth);
    if (!date) {
      issues.push({ sheet: tabName, kind: 'error', message: 'no date could be read for this tab - skipped' });
      sheetsSkipped.push(tabName);
      continue;
    }

    sheetsRead++;
    datesSeen.add(date);
    const map = header.map;
    const cell = (row: unknown[], key: HeaderKey) => (map[key] == null ? '' : text(row[map[key] as number]));
    let section: 'leave' | 'off' | 'work' = 'work';

    for (let i = header.row + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const filled = row.map((value) => String(value == null ? '' : value).trim()).filter(Boolean);
      if (!filled.length) continue;

      const name = cell(row, 'doctor');
      const timeText = map.shifts != null ? cell(row, 'shifts') : `${cell(row, 'from')} ${cell(row, 'to')}`.trim();

      // A section title such as "On leave today" or "Off today".
      if (!name || (!timeText && filled.length <= 2)) {
        const next = sectionOf(name || filled.join(' '));
        if (next && (!name || filled.length <= 2)) {
          section = next;
          continue;
        }
        if (!name) continue;
      }

      // A repeated header row: its time column says which list follows.
      if (HEADER_RE.test(name)) {
        const next = sectionOf(timeText) || sectionOf(cell(row, 'note'));
        if (next) section = next;
        issues.push({ sheet: tabName, row: i + 1, date, kind: 'layout', message: 'repeated header row' });
        continue;
      }

      // "Doctors on duty 22", "Total hours 104": counts, not doctors.
      if (SUMMARY_RE.test(name)) {
        issues.push({ sheet: tabName, row: i + 1, date, kind: 'layout', message: 'summary row' });
        continue;
      }

      if (section === 'off') {
        leave.push({
          workDate: date,
          doctorText: name,
          doctorKey: normalizePersonName(name),
          specialtyText: cell(row, 'spec') || null,
          leaveKind: 'off',
          plannedMinutes: 0,
          note: cell(row, 'note') || null,
          sourceSheet: tabName,
          sourceRow: i + 1,
        });
        continue;
      }

      let parsed: [number, number][] = [];
      let note: string | null = null;
      if (map.shifts != null) {
        const result = parseShiftText(row[map.shifts]);
        parsed = result.shifts;
        note = result.note;
      } else {
        const from = parseClock(row[map.from as number]);
        const to = parseClock(row[map.to as number]);
        if (from != null && to != null) parsed = [[from, to]];
        else if (row[map.from as number] || row[map.to as number]) note = 'UNREADABLE TIMES';
      }

      const totals = shiftMinutes(parsed);
      const noteText = cell(row, 'note');
      let specialty = cell(row, 'spec');
      if (!specialty && defaultSpecialty) {
        specialty = defaultSpecialty;
        defaultSpecialtyUsed = true;
      }
      const specialtyText = specialty || null;

      const away =
        section === 'leave' ||
        LEAVE_NOTE_RE.test(noteText) ||
        /^(LEAVE|ANNUAL|VACATION|SICK|ABSENT)$/.test(String(note || ''));

      if (away) {
        // Planned hours that will not be worked. Kept for the record, never
        // counted as capacity; a booking on this day shows as not rostered.
        const leaveKind: LeaveKind = section === 'leave' ? 'leave' : 'absent';
        leave.push({
          workDate: date,
          doctorText: name,
          doctorKey: normalizePersonName(name),
          specialtyText,
          leaveKind,
          plannedMinutes: totals.minutes,
          note: noteText || null,
          sourceSheet: tabName,
          sourceRow: i + 1,
        });
        continue;
      }

      if (!totals.clean.length && !note && !totals.flags.length) continue;

      for (const [startMin, endMin] of totals.clean) {
        shifts.push({
          workDate: date,
          doctorText: name,
          doctorKey: normalizePersonName(name),
          specialtyText,
          startMin,
          endMin,
          carriedFromDate: null,
          fixes: totals.fixes,
          note,
          sourceSheet: tabName,
          sourceRow: i + 1,
        });
      }

      for (const shift of totals.carry) {
        carried.push({
          fromDate: date,
          date: nextDay(date),
          doctorText: name,
          specialtyText,
          shift,
          sheet: tabName,
          row: i + 1,
        });
      }

      for (const flag of totals.flags) {
        issues.push({ sheet: tabName, row: i + 1, date, doctor: name, kind: 'error', message: flag });
      }
      if (note && note.startsWith('UNREADABLE')) {
        issues.push({ sheet: tabName, row: i + 1, date, doctor: name, kind: 'error', message: note });
      } else if (note === 'PARTLY UNREADABLE') {
        issues.push({
          sheet: tabName,
          row: i + 1,
          date,
          doctor: name,
          kind: 'error',
          message: 'part of the shift text could not be read',
        });
      }

      // Cross-check against the sheet's own Hours column when it has one.
      if (map.hours != null && totals.clean.length) {
        const stated = parseFloat(String(row[map.hours] ?? '').replace(',', '.'));
        const own = totals.minutes + totals.carry.reduce((sum, [a, b]) => sum + b - a, 0);
        if (Number.isFinite(stated) && Math.abs(stated * 60 - own) > 1) {
          issues.push({
            sheet: tabName,
            row: i + 1,
            date,
            doctor: name,
            kind: 'check',
            message:
              `Hours column says ${stated} h but the shift runs ` +
              `${(own / 60).toFixed(2).replace(/\.?0+$/, '')} h - the shift time was used`,
          });
        }
      }
    }
  }

  // Hours after midnight belong to the next date.
  for (const entry of carried) {
    if (datesSeen.has(entry.date)) {
      shifts.push({
        workDate: entry.date,
        doctorText: entry.doctorText,
        doctorKey: normalizePersonName(entry.doctorText),
        specialtyText: entry.specialtyText,
        startMin: entry.shift[0],
        endMin: entry.shift[1],
        carriedFromDate: entry.fromDate,
        fixes: ['overnight'],
        note: `continues from ${prettyDate(entry.fromDate)}`,
        sourceSheet: entry.sheet,
        sourceRow: entry.row,
      });
    } else {
      issues.push({
        sheet: entry.sheet,
        row: entry.row,
        date: entry.fromDate,
        doctor: entry.doctorText,
        kind: 'check',
        message:
          `shift runs past midnight into ${prettyDate(entry.date)}, which is not in this file - ` +
          `${(entry.shift[1] - entry.shift[0]) / 60} h after midnight not counted`,
      });
    }
  }

  const mergedLeave = mergeLeave(leave);

  const preview = buildPreview({
    shifts,
    leave: mergedLeave,
    issues,
    sheetsRead,
    sheetsSkipped,
    defaultSpecialtyApplied: defaultSpecialtyUsed ? defaultSpecialty : null,
    rejectedDefaultSpecialty,
  });

  trace?.(`schedule: ${shifts.length} shift row(s), ${mergedLeave.length} leave row(s)`);
  return { shifts, leave: mergedLeave, preview, errors: preview.errors };
}

/**
 * One leave entry per doctor, day and kind, carrying their whole planned day.
 *
 * A doctor with a split shift appears on two rows of the leave section — Dr
 * Mohamed Diab is listed twice on 1 October, for 5 h and 4 h. Those are two
 * halves of one day off, so the planned minutes are summed. Keeping them as
 * separate rows would either double-count the day or, once stored against a
 * one-row-per-doctor-per-day key, silently drop the second and lose the hours.
 */
function mergeLeave(rows: ParsedLeaveRow[]): ParsedLeaveRow[] {
  const merged = new Map<string, ParsedLeaveRow>();
  for (const row of rows) {
    const key = `${row.workDate}|${row.doctorKey}|${row.leaveKind}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.plannedMinutes += row.plannedMinutes;
    if (!existing.note && row.note) existing.note = row.note;
    if (!existing.specialtyText && row.specialtyText) existing.specialtyText = row.specialtyText;
  }
  return [...merged.values()];
}

function buildPreview(args: {
  shifts: ParsedShiftRow[];
  leave: ParsedLeaveRow[];
  issues: CapacityIssue[];
  sheetsRead: number;
  sheetsSkipped: string[];
  defaultSpecialtyApplied: string | null;
  rejectedDefaultSpecialty: string | null;
}): SchedulePreview {
  const { shifts, leave, issues, sheetsRead, sheetsSkipped } = args;
  const dates = new Set<string>();
  shifts.forEach((row) => dates.add(row.workDate));
  leave.forEach((row) => dates.add(row.workDate));
  const ordered = [...dates].sort();
  const coverageStart = ordered[0] ?? null;
  const coverageEnd = ordered[ordered.length - 1] ?? null;

  const missingDates: string[] = [];
  if (coverageStart && coverageEnd) {
    for (let cursor = coverageStart; cursor <= coverageEnd; cursor = nextDay(cursor)) {
      if (!dates.has(cursor)) missingDates.push(cursor);
    }
  }

  const specialties = new Set<string>();
  shifts.forEach((row) => row.specialtyText && specialties.add(row.specialtyText));
  const doctors = new Set(shifts.map((row) => row.doctorKey));

  const errors = issues.filter((issue) => issue.kind === 'error').map((issue) => {
    const where = issue.row ? `${issue.sheet} row ${issue.row}` : issue.sheet;
    return `${where}: ${issue.message}`;
  });

  if (args.rejectedDefaultSpecialty) {
    issues.push({
      sheet: '-',
      kind: 'check',
      message:
        `"${args.rejectedDefaultSpecialty}" looks like the sheet title, not a specialty, ` +
        'so it was not used for rows with a blank Specialty cell',
    });
  }

  return {
    sheetsRead,
    sheetsSkipped,
    coverageStart,
    coverageEnd,
    datesCovered: ordered.length,
    missingDates,
    shiftRows: shifts.length,
    leaveRows: leave.length,
    rosteredMinutes: shifts.reduce((sum, row) => sum + (row.endMin - row.startMin), 0),
    plannedLeaveMinutes: leave.reduce((sum, row) => sum + row.plannedMinutes, 0),
    distinctDoctors: doctors.size,
    distinctSpecialties: [...specialties].sort(),
    defaultSpecialtyApplied: args.defaultSpecialtyApplied,
    issues,
    errors,
  };
}

export { isoDate, sheetDate as readSheetDate, sectionOf as readSectionOf };
