/**
 * Clock and shift arithmetic, ported from the Capacity Analyser tool
 * (lines 563-637). Every time in this feature is "minutes since midnight", so a
 * shift is a [start, end) pair of integers in 0..1440.
 */

export const OVERNIGHT_MAX = 8 * 60; // an end time up to 8:00 AM reads as the next morning
const MAX_SHIFT_MINUTES = 16 * 60;

export const pad2 = (value: number) => String(value).padStart(2, '0');

export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const nextDay = (date: string) => {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + 1);
  return isoDate(parsed);
};

export const prettyDate = (date: string) => {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
};

export function hhmmAmPm(minutes: number | null): string {
  if (minutes == null) return '';
  const hour24 = Math.floor(minutes / 60) % 24;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${pad2(minutes % 60)} ${suffix}`;
}

/** Minutes of overlap between two [start, end) ranges. */
export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Read a single clock value. Accepts a Date, an Excel day fraction, "10:00 AM",
 * "14:30" and "9 PM". Returns null when the text is not a time at all, which the
 * caller reports rather than guessing at.
 */
export function parseClock(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    return Math.round(value * 1440);
  }
  const text = String(value).trim();
  if (!text) return null;
  const match =
    text.match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*([APap]\.?[Mm]\.?)?$/) ||
    text.match(/^(\d{1,2})\s*()([APap]\.?[Mm]\.?)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3] ? match[3].toLowerCase().replace(/\./g, '') : null;
  if (hour > 23 || minute > 59) return null;
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

export interface ParsedShiftText {
  shifts: [number, number][];
  note: string | null;
}

/**
 * Read a "Working Hours" cell. One cell can hold several shifts separated by
 * "|", ";", a newline or "and". A cell that only says LEAVE/OFF/N-A carries no
 * times and is returned as a note for the caller to classify.
 */
export function parseShiftText(value: unknown): ParsedShiftText {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { shifts: [], note: null };

  const flat = raw.toUpperCase().replace(/\s+/g, ' ');
  if (/^(LEAVE|OFF|ANNUAL|VACATION|SICK|ABSENT|HOLIDAY|N\/?A|-|—)$/.test(flat)) {
    return { shifts: [], note: /^(N\/?A|-|—)$/.test(flat) ? 'NOT WORKING' : flat };
  }

  const time = '(\\d{1,2}\\s*[:.]\\s*\\d{2}\\s*[APap]\\.?[Mm]\\.?|\\d{1,2}\\s*[:.]\\s*\\d{2}|\\d{1,2}\\s*[APap]\\.?[Mm]\\.?)';
  const shifts: [number, number][] = [];
  let unreadable = false;

  for (const part of raw.split(/\||،|;|\n|\bAND\b/i)) {
    if (!part.trim()) continue;
    const match = part.match(new RegExp(`${time}\\s*(?:-|–|—|to|until|till)\\s*${time}`, 'i'));
    if (!match) {
      unreadable = true;
      continue;
    }
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    if (start == null || end == null) {
      unreadable = true;
      continue;
    }
    shifts.push([start, end]);
  }

  if (!shifts.length) {
    return { shifts: [], note: unreadable ? `UNREADABLE: ${raw.slice(0, 40)}` : flat };
  }
  return { shifts, note: unreadable ? 'PARTLY UNREADABLE' : null };
}

export type ShiftFix = 'midnight' | 'overnight';

export interface ShiftMinutes {
  minutes: number;
  clean: [number, number][];
  flags: string[];
  /** Minutes after midnight, to be credited to the following date. */
  carry: [number, number][];
  fixes: ShiftFix[];
}

/**
 * Total a doctor's shifts for one day.
 *
 * A shift written "10:00 PM - 12:00 AM" ends at midnight, not before it started.
 * One written "10:00 PM - 2:00 AM" runs into the next day: the part before
 * midnight stays here and the remainder is carried. Anything else that ends
 * before it starts is a real error and is reported, not silently repaired.
 */
export function shiftMinutes(input: [number, number][]): ShiftMinutes {
  const flags: string[] = [];
  const clean: [number, number][] = [];
  const carry: [number, number][] = [];
  const fixes: ShiftFix[] = [];
  let total = 0;

  for (const [start, rawEnd] of [...input].sort((a, b) => a[0] - b[0])) {
    let end = rawEnd;
    if (end === 0 && start > 0) {
      end = 1440;
      fixes.push('midnight');
    } else if (end < start && end <= OVERNIGHT_MAX) {
      carry.push([0, end]);
      end = 1440;
      fixes.push('overnight');
    }

    const duration = end - start;
    if (duration === 0) {
      flags.push('zero-length shift');
      continue;
    }
    if (duration < 0) {
      flags.push('end time is before start time');
      continue;
    }
    if (duration > MAX_SHIFT_MINUTES) {
      flags.push('shift longer than 16 hours');
      continue;
    }
    clean.push([start, end]);
    total += duration;
  }

  for (let i = 1; i < clean.length; i++) {
    if (clean[i][0] < clean[i - 1][1]) flags.push('overlapping shifts');
  }

  return { minutes: total, clean, flags, carry, fixes };
}
