// Chronic business calendar.
//
// The AUTHORITATIVE calendar lives in the database table `healpath.chronic_calendar`
// (columns: week, month_name, year, month_order, period). This module does NOT
// hardcode the mapping for runtime use — the lookup helpers below all operate on a
// calendar array that is passed in (loaded from that table). It only holds:
//   1. CHRONIC_CALENDAR_SEED — the initial weeks 1..28 (Dec 2025 → Jun 2026) used
//      to seed the table the first time and as an offline fallback, and
//   2. pure, calendar-driven helpers shared by the query layer, the import route,
//      and the client import preview.
//
// Adding weeks 29, 30, 31 … requires ONLY inserting rows into the table — no code
// change. Nothing here assumes every week exists (a partial period is valid).

export interface ChronicCalendarEntry {
  week: number;
  month_name: string;
  year: number;
  month_order: number;
  /** User-facing label, e.g. "Jun 2026". */
  period: string;
}

export const CHRONIC_WEEKS_PER_MONTH = 4;

const MONTH_ABBR: Record<string, string> = {
  January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'May', June: 'Jun',
  July: 'Jul', August: 'Aug', September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec',
};
const MONTH_NUMBER: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

/** Period label from a month name + year, e.g. ("June", 2026) -> "Jun 2026". */
export function chronicPeriodLabel(monthName: string, year: number): string {
  return `${MONTH_ABBR[monthName] ?? monthName.slice(0, 3)} ${year}`;
}

/** Canonical YYYY-MM for a month name + year (kept for the legacy `month` column). */
export function chronicYm(monthName: string, year: number): string {
  const number = MONTH_NUMBER[monthName] ?? 1;
  return `${year}-${String(number).padStart(2, '0')}`;
}

const SEED_MONTHS: { month_name: string; year: number }[] = [
  { month_name: 'December', year: 2025 },
  { month_name: 'January', year: 2026 },
  { month_name: 'February', year: 2026 },
  { month_name: 'March', year: 2026 },
  { month_name: 'April', year: 2026 },
  { month_name: 'May', year: 2026 },
  { month_name: 'June', year: 2026 },
];

/** Initial calendar rows (weeks 1..28), used to seed the DB table + as fallback. */
export const CHRONIC_CALENDAR_SEED: ChronicCalendarEntry[] = SEED_MONTHS.flatMap((month, index) =>
  Array.from({ length: CHRONIC_WEEKS_PER_MONTH }, (_, offset) => ({
    week: index * CHRONIC_WEEKS_PER_MONTH + offset + 1,
    month_name: month.month_name,
    year: month.year,
    month_order: index + 1,
    period: chronicPeriodLabel(month.month_name, month.year),
  })),
);

/** Parse any week representation (21, "21", "Week 21", "W21") to a positive int, else null. */
export function chronicWeekNumber(week: unknown): number | null {
  if (week == null) return null;
  const match = String(week).match(/\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

/** The calendar entry a week resolves to, or null when the calendar has no such week. */
export function chronicEntryForWeek(calendar: ChronicCalendarEntry[], week: unknown): ChronicCalendarEntry | null {
  const number = chronicWeekNumber(week);
  if (number == null) return null;
  return calendar.find((entry) => entry.week === number) ?? null;
}

/** The internal week list for a period label, e.g. "May 2026" -> [21,22,23,24]. */
export function chronicWeeksForPeriod(calendar: ChronicCalendarEntry[], period: string | null | undefined): number[] {
  const key = (period ?? '').trim().toLowerCase();
  if (!key) return [];
  return calendar.filter((entry) => entry.period.toLowerCase() === key).map((entry) => entry.week).sort((a, b) => a - b);
}

/** Ordered, de-duplicated periods present in a set of weeks. */
export function chronicPeriodsForWeeks(calendar: ChronicCalendarEntry[], weeks: Iterable<unknown>): ChronicCalendarEntry[] {
  const byPeriod = new Map<string, ChronicCalendarEntry>();
  for (const week of weeks) {
    const entry = chronicEntryForWeek(calendar, week);
    if (entry && !byPeriod.has(entry.period)) byPeriod.set(entry.period, entry);
  }
  return [...byPeriod.values()].sort((a, b) => a.month_order - b.month_order || a.year - b.year);
}

/** Every distinct period the calendar knows, ordered chronologically. */
export function chronicOrderedPeriods(calendar: ChronicCalendarEntry[]): string[] {
  const order = new Map<string, number>();
  for (const entry of calendar) if (!order.has(entry.period)) order.set(entry.period, entry.month_order);
  return [...order.entries()].sort((a, b) => a[1] - b[1]).map(([period]) => period);
}

/** Human label for detected periods: "May 2026" | "Dec 2025 → Jun 2026" | comma list. */
export function chronicDetectedPeriodsLabel(calendar: ChronicCalendarEntry[], weeks: Iterable<unknown>): string {
  const periods = chronicPeriodsForWeeks(calendar, weeks);
  if (!periods.length) return 'Not detected';
  if (periods.length === 1) return periods[0].period;
  const orders = periods.map((entry) => entry.month_order);
  const contiguous = orders.every((order, index) => index === 0 || order === orders[index - 1] + 1);
  return contiguous
    ? `${periods[0].period} → ${periods[periods.length - 1].period}`
    : periods.map((entry) => entry.period).join(', ');
}

/** Weeks Found range label, e.g. "1–27" or "21". */
export function chronicWeekRangeLabel(weeks: Iterable<unknown>): string {
  const numbers = sortedWeekNumbers(weeks);
  if (!numbers.length) return '-';
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? `${first}` : `${first}–${last}`;
}

/**
 * Missing weeks: for every period with at least one imported week, the weeks the
 * calendar expects but that are absent. Informational only — never an error.
 */
export function chronicMissingWeeks(calendar: ChronicCalendarEntry[], weeks: Iterable<unknown>): number[] {
  const present = new Set(sortedWeekNumbers(weeks));
  const coveredPeriods = new Set(chronicPeriodsForWeeks(calendar, present).map((entry) => entry.period));
  const expected = calendar.filter((entry) => coveredPeriods.has(entry.period)).map((entry) => entry.week);
  return expected.filter((week) => !present.has(week)).sort((a, b) => a - b);
}

function sortedWeekNumbers(weeks: Iterable<unknown>): number[] {
  const numbers: number[] = [];
  for (const week of weeks) {
    const number = chronicWeekNumber(week);
    if (number != null) numbers.push(number);
  }
  return numbers.sort((a, b) => a - b);
}
