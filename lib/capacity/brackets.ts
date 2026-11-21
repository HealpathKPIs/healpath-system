/**
 * Capacity cut by specialty and time-of-day bracket.
 *
 * The existing specialty table answers "is this specialty busy?". It cannot
 * answer the question the rota is actually built from: *when* is it busy. A
 * specialty can sit at 105% for the month and still have a two-hour window
 * every evening running at 40% while the afternoon is double-booked. Those two
 * facts are invisible in a monthly total and are the only ones a shift change
 * can act on, so they get their own cut.
 *
 * The bracket is the time of day, two hours wide, taken from the appointment's
 * own start time for demand and from the overlap of the rostered shift for
 * supply. Both sides are measured on the same clock, which is what makes
 * utilisation inside a bracket comparable to utilisation outside it.
 *
 * Three rules are inherited from engine.ts deliberately, so this table can be
 * reconciled against the ones above it rather than argued with:
 *
 *  1. The specialty is the doctor's resolved main specialty, passed in from
 *     analyse(). Deriving it again here would let the two tables disagree the
 *     moment somebody edits an alias.
 *  2. Appointments on a day the doctor has no shift are counted, in their own
 *     column, and never enter utilisation - there are no rostered minutes in
 *     that bracket to divide them by.
 *  3. Pending / Due / Waiting Room count as completed, for the reason given in
 *     engine.ts.
 */

import {
  DEFAULT_CAPACITY_CONFIG,
  slotMinutes,
  type CapacityConfig,
  type ShiftInput,
} from './engine';
import { UNASSIGNED } from './specialties';

/**
 * Two hours. Narrow enough to separate a morning clinic from an evening one,
 * wide enough that a single doctor's shift still fills a cell: at one hour the
 * grid is mostly noise from shifts that start on the half hour.
 */
export const BRACKET_MINUTES = 120;

/** Sentinel bracket for a row or column roll-up, never a real time of day. */
export const ALL_BRACKETS = -1;

export type BracketStatus = 'completed' | 'canceled' | 'noshow' | 'other';

/** Appointments pre-grouped by the database, with the start time kept. */
export interface BracketAppointmentGroup {
  date: string;
  doctorId: number;
  /** Start of the bracket in minutes from midnight, or null when untimed. */
  bracketStart: number | null;
  apptType: string | null;
  statusBucket: BracketStatus;
  count: number;
}

export interface BracketCell {
  specialty: string;
  /** Minutes from midnight, or ALL_BRACKETS on a roll-up. */
  bracketStart: number;
  doctors: number;
  rosteredMinutes: number;
  slots: number;
  /**
   * Bookings made against rostered time, and the three states they ended in.
   *
   * Off-roster bookings are deliberately NOT in here. They have no minutes in
   * this bracket to be measured against, so including them would make
   * `booked / slots` disagree with the utilisation printed beside it - a table
   * that fails its own arithmetic. They are in `notRostered` instead, and
   * `booked + notRostered` is the figure the specialty table reports.
   */
  booked: number;
  completed: number;
  canceled: number;
  noShow: number;
  /** Booked in this bracket on a day with no shift. Counted, never divided. */
  notRostered: number;
  bookedMinutesRostered: number;
  completedMinutesRostered: number;
  utilisation: number | null;
  yield: number | null;
  /** Slots left standing. Clamped at zero: an overbooked bracket has none. */
  unbookedSlots: number;
}

export interface SpecialtyBracketRow {
  specialty: string;
  /** One cell per entry of `brackets`, in the same order, zero-filled. */
  cells: BracketCell[];
  total: BracketCell;
}

export interface BracketColumn {
  start: number;
  label: string;
  shortLabel: string;
}

export interface SpecialtyBracketResult {
  brackets: BracketColumn[];
  rows: SpecialtyBracketRow[];
  /** Column roll-ups, aligned to `brackets`. */
  columnTotals: BracketCell[];
  grandTotal: BracketCell;
  /** Appointments the export carried no start time for, so unplaceable. */
  untimed: number;
}

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

export function bracketStartOf(minute: number): number {
  return Math.floor(minute / BRACKET_MINUTES) * BRACKET_MINUTES;
}

function clockLabel(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function bracketLabel(start: number): string {
  if (start === ALL_BRACKETS) return 'All brackets';
  return `${clockLabel(start)} – ${clockLabel(start + BRACKET_MINUTES)}`;
}

/** Column heading: the hour the bracket opens, which the width then implies. */
export function bracketShortLabel(start: number): string {
  if (start === ALL_BRACKETS) return 'All';
  const wrapped = ((start % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${hour24 < 12 ? 'am' : 'pm'}`;
}

function emptyCell(specialty: string, bracketStart: number): BracketCell {
  return {
    specialty,
    bracketStart,
    doctors: 0,
    rosteredMinutes: 0,
    slots: 0,
    booked: 0,
    completed: 0,
    canceled: 0,
    noShow: 0,
    notRostered: 0,
    bookedMinutesRostered: 0,
    completedMinutesRostered: 0,
    utilisation: null,
    yield: null,
    unbookedSlots: 0,
  };
}

function addInto(target: BracketCell, source: BracketCell): void {
  target.rosteredMinutes += source.rosteredMinutes;
  target.booked += source.booked;
  target.completed += source.completed;
  target.canceled += source.canceled;
  target.noShow += source.noShow;
  target.notRostered += source.notRostered;
  target.bookedMinutesRostered += source.bookedMinutesRostered;
  target.completedMinutesRostered += source.completedMinutesRostered;
}

/**
 * Slots come from the roll-up's own minutes, never from summing the cells'.
 * Summing rounds once per bracket and the row then fails to equal its parts.
 */
function finalise(cell: BracketCell, slotMin: number): void {
  cell.slots = slotMin > 0 ? Math.round(cell.rosteredMinutes / slotMin) : 0;
  cell.utilisation = ratio(cell.bookedMinutesRostered, cell.rosteredMinutes);
  cell.yield = ratio(cell.completedMinutesRostered, cell.rosteredMinutes);
  cell.unbookedSlots = Math.max(0, cell.slots - cell.booked);
}

export function analyseSpecialtyBrackets(
  shifts: ShiftInput[],
  groups: BracketAppointmentGroup[],
  doctors: { doctorId: number; mainSpecialty: string }[],
  config: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
): SpecialtyBracketResult {
  const specialtyOf = new Map(doctors.map((doctor) => [doctor.doctorId, doctor.mainSpecialty]));
  const nameOf = (doctorId: number) => specialtyOf.get(doctorId) ?? UNASSIGNED;

  const cells = new Map<string, BracketCell>();
  const cellDoctors = new Map<string, Set<number>>();
  const rowDoctors = new Map<string, Set<number>>();
  const columnDoctors = new Map<number, Set<number>>();
  const allDoctors = new Set<number>();
  const bracketsSeen = new Set<number>();
  const rosteredDays = new Set<string>();

  const key = (specialty: string, bracketStart: number) => `${specialty}|${bracketStart}`;
  const cellFor = (specialty: string, bracketStart: number): BracketCell => {
    const id = key(specialty, bracketStart);
    let cell = cells.get(id);
    if (!cell) {
      cell = emptyCell(specialty, bracketStart);
      cells.set(id, cell);
    }
    bracketsSeen.add(bracketStart);
    return cell;
  };

  const noteDoctor = (specialty: string, bracketStart: number, doctorId: number) => {
    const id = key(specialty, bracketStart);
    if (!cellDoctors.has(id)) cellDoctors.set(id, new Set());
    cellDoctors.get(id)!.add(doctorId);
    if (!rowDoctors.has(specialty)) rowDoctors.set(specialty, new Set());
    rowDoctors.get(specialty)!.add(doctorId);
    if (!columnDoctors.has(bracketStart)) columnDoctors.set(bracketStart, new Set());
    columnDoctors.get(bracketStart)!.add(doctorId);
    allDoctors.add(doctorId);
  };

  // Supply. A shift is spread across every bracket it touches, by the minutes
  // it actually occupies there - a 13:30-16:00 shift puts 30 minutes in the
  // noon bracket and 120 in the 2pm one, never 150 in whichever it started in.
  for (const shift of shifts) {
    rosteredDays.add(`${shift.doctorId}|${shift.date}`);
    const specialty = nameOf(shift.doctorId);
    const start = Math.min(shift.startMin, shift.endMin);
    const end = Math.max(shift.startMin, shift.endMin);
    if (end <= start) continue;

    for (let edge = bracketStartOf(start); edge < end; edge += BRACKET_MINUTES) {
      const overlap = Math.min(end, edge + BRACKET_MINUTES) - Math.max(start, edge);
      if (overlap <= 0) continue;
      cellFor(specialty, edge).rosteredMinutes += overlap;
      noteDoctor(specialty, edge, shift.doctorId);
    }
  }

  // Demand.
  let untimed = 0;
  for (const group of groups) {
    if (group.bracketStart == null) {
      untimed += group.count;
      continue;
    }
    const specialty = nameOf(group.doctorId);
    const cell = cellFor(specialty, bracketStartOf(group.bracketStart));
    const minutes = slotMinutes(group.apptType, config) * group.count;

    if (!rosteredDays.has(`${group.doctorId}|${group.date}`)) {
      cell.notRostered += group.count;
      continue;
    }

    cell.booked += group.count;
    cell.bookedMinutesRostered += minutes;
    if (group.statusBucket === 'canceled') {
      cell.canceled += group.count;
    } else if (group.statusBucket === 'noshow') {
      cell.noShow += group.count;
    } else {
      cell.completed += group.count;
      cell.completedMinutesRostered += minutes;
    }
  }

  const slotMin = config.defaultSlotMinutes;
  const brackets: BracketColumn[] = [...bracketsSeen]
    .sort((a, b) => a - b)
    .map((start) => ({
      start,
      label: bracketLabel(start),
      shortLabel: bracketShortLabel(start),
    }));

  const specialties = [...new Set([...cells.values()].map((cell) => cell.specialty))];
  const rows: SpecialtyBracketRow[] = specialties.map((specialty) => {
    const total = emptyCell(specialty, ALL_BRACKETS);
    const rowCells = brackets.map((bracket) => {
      const cell = cells.get(key(specialty, bracket.start)) ?? emptyCell(specialty, bracket.start);
      cell.doctors = cellDoctors.get(key(specialty, bracket.start))?.size ?? 0;
      finalise(cell, slotMin);
      addInto(total, cell);
      return cell;
    });
    total.doctors = rowDoctors.get(specialty)?.size ?? 0;
    finalise(total, slotMin);
    return { specialty, cells: rowCells, total };
  });

  // Rostered time first: a specialty with no roster at all is a data problem,
  // not a busy clinic, and belongs at the bottom rather than wherever its
  // booking count happens to put it.
  rows.sort(
    (a, b) =>
      b.total.rosteredMinutes - a.total.rosteredMinutes ||
      b.total.booked - a.total.booked ||
      a.specialty.localeCompare(b.specialty),
  );

  const columnTotals = brackets.map((bracket, index) => {
    const total = emptyCell('All specialties', bracket.start);
    for (const row of rows) addInto(total, row.cells[index]);
    total.doctors = columnDoctors.get(bracket.start)?.size ?? 0;
    finalise(total, slotMin);
    return total;
  });

  const grandTotal = emptyCell('All specialties', ALL_BRACKETS);
  for (const row of rows) addInto(grandTotal, row.total);
  grandTotal.doctors = allDoctors.size;
  finalise(grandTotal, slotMin);

  return { brackets, rows, columnTotals, grandTotal, untimed };
}
