/**
 * The capacity metric engine, ported from the Capacity Analyser tool
 * (`analyse`, lines 856-1123).
 *
 * It runs in TypeScript over rows the database has already grouped, rather than
 * in SQL or at import time. Slot minutes depend on the doctor's *resolved*
 * specialty, which only exists after alias and grouping decisions are applied,
 * and those decisions are editable and must apply retroactively to history.
 * Computing at import would freeze exactly the inputs that are meant to change.
 *
 * Three behaviours here are easy to get wrong and are covered by tests:
 *
 *  1. Utilisation and yield always share one denominator, and that denominator
 *     follows the current selection.
 *  2. Appointments on a day the doctor is not rostered count in the totals but
 *     never in the ratio. Dividing their minutes by zero rostered minutes would
 *     inflate every percentage on the page.
 *  3. Pending, Due and Waiting Room are reported as completed. They are visits
 *     that happened whose record was never closed, so they count toward yield;
 *     the number folded in is kept separately so the page can say so.
 */

import { resolveMainSpecialty, UNASSIGNED, type SpecialtyConfig } from './specialties';

export interface CapacityConfig {
  defaultSlotMinutes: number;
  amBoundaryMinutes: number;
  specialties: SpecialtyConfig;
}

export const DEFAULT_CAPACITY_CONFIG: CapacityConfig = {
  defaultSlotMinutes: 15,
  amBoundaryMinutes: 720,
  specialties: { known: [], overrides: new Map() },
};

/** One rostered block. Overnight shifts are already split by the parser. */
export interface ShiftInput {
  date: string;
  doctorId: number;
  doctorName: string;
  specialty: string | null;
  startMin: number;
  endMin: number;
}

/** Appointments pre-grouped by the database. */
export interface AppointmentGroup {
  date: string;
  doctorId: number;
  doctorName: string;
  specialty: string | null;
  apptType: string | null;
  statusBucket: 'completed' | 'canceled' | 'noshow' | 'other';
  count: number;
}

export interface DoctorMetrics {
  doctorId: number;
  doctor: string;
  specialty: string;
  mainSpecialty: string;
  rosteredMinutes: number;
  daysRostered: number;
  booked: number;
  completed: number;
  canceled: number;
  noShow: number;
  /**
   * How many of `completed` arrived with a Pending, Due or Waiting Room status.
   * Reported alongside, never added to the total a second time.
   */
  inProgress: number;
  /** Booked on days with no shift: counted here, never in the ratios. */
  notRostered: number;
  bookedMinutes: number;
  bookedMinutesRostered: number;
  completedMinutesRostered: number;
  utilisation: number | null;
  yield: number | null;
  idleMinutes: number;
}

export interface SpecialtyMetrics {
  specialty: string;
  doctors: number;
  rosteredMinutes: number;
  booked: number;
  completed: number;
  canceled: number;
  noShow: number;
  inProgress: number;
  notRostered: number;
  bookedMinutesRostered: number;
  completedMinutesRostered: number;
  utilisation: number | null;
  yield: number | null;
}

export interface CapacityTotals {
  rosteredMinutes: number;
  doctors: number;
  daysCovered: number;
  booked: number;
  completed: number;
  canceled: number;
  noShow: number;
  inProgress: number;
  notRostered: number;
  bookedMinutesRostered: number;
  completedMinutesRostered: number;
  utilisation: number | null;
  yield: number | null;
  idleMinutes: number;
}

export interface CapacityResult {
  totals: CapacityTotals;
  doctors: DoctorMetrics[];
  specialties: SpecialtyMetrics[];
}

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

/** Minutes one appointment occupies. Phase 1 has no per-type rules yet. */
export function slotMinutes(_apptType: string | null, config: CapacityConfig): number {
  return config.defaultSlotMinutes;
}

export function analyse(
  shifts: ShiftInput[],
  groups: AppointmentGroup[],
  config: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
): CapacityResult {
  const doctors = new Map<number, DoctorMetrics>();
  const dates = new Set<string>();

  // Which (doctor, date) pairs carry rostered time? This is what separates a
  // booking that consumed capacity from one that had none to consume.
  const rosteredDays = new Set<string>();

  const ensure = (doctorId: number, doctorName: string, specialty: string | null): DoctorMetrics => {
    let entry = doctors.get(doctorId);
    if (!entry) {
      const resolved = specialty || UNASSIGNED;
      entry = {
        doctorId,
        doctor: doctorName,
        specialty: resolved,
        mainSpecialty: resolveMainSpecialty(resolved, config.specialties),
        rosteredMinutes: 0,
        daysRostered: 0,
        booked: 0,
        completed: 0,
        canceled: 0,
        noShow: 0,
        inProgress: 0,
        notRostered: 0,
        bookedMinutes: 0,
        bookedMinutesRostered: 0,
        completedMinutesRostered: 0,
        utilisation: null,
        yield: null,
        idleMinutes: 0,
      };
      doctors.set(doctorId, entry);
    } else if (entry.specialty === UNASSIGNED && specialty) {
      entry.specialty = specialty;
      entry.mainSpecialty = resolveMainSpecialty(specialty, config.specialties);
    }
    return entry;
  };

  const dayCounts = new Map<number, Set<string>>();

  for (const shift of shifts) {
    const entry = ensure(shift.doctorId, shift.doctorName, shift.specialty);
    entry.rosteredMinutes += Math.max(0, shift.endMin - shift.startMin);
    rosteredDays.add(`${shift.doctorId}|${shift.date}`);
    dates.add(shift.date);
    if (!dayCounts.has(shift.doctorId)) dayCounts.set(shift.doctorId, new Set());
    dayCounts.get(shift.doctorId)!.add(shift.date);
  }
  for (const [doctorId, days] of dayCounts) {
    const entry = doctors.get(doctorId);
    if (entry) entry.daysRostered = days.size;
  }

  for (const group of groups) {
    const entry = ensure(group.doctorId, group.doctorName, group.specialty);
    dates.add(group.date);

    const minutes = slotMinutes(group.apptType, config) * group.count;
    entry.booked += group.count;
    entry.bookedMinutes += minutes;

    switch (group.statusBucket) {
      case 'canceled':
        entry.canceled += group.count;
        break;
      case 'noshow':
        entry.noShow += group.count;
        break;
      default:
        // 'completed', plus Pending / Due Appointment / Waiting Room. Those
        // three are visits that took place but whose record was never closed,
        // so they are reported as completed. The count is kept in inProgress
        // purely so the page can say how many were folded in - it is not a
        // fourth state and must not be added to the total again.
        entry.completed += group.count;
        if (group.statusBucket === 'other') entry.inProgress += group.count;
    }

    if (rosteredDays.has(`${group.doctorId}|${group.date}`)) {
      entry.bookedMinutesRostered += minutes;
      if (group.statusBucket !== 'canceled' && group.statusBucket !== 'noshow') {
        entry.completedMinutesRostered += minutes;
      }
    } else {
      entry.notRostered += group.count;
    }
  }

  for (const entry of doctors.values()) {
    entry.utilisation = ratio(entry.bookedMinutesRostered, entry.rosteredMinutes);
    entry.yield = ratio(entry.completedMinutesRostered, entry.rosteredMinutes);
    entry.idleMinutes = Math.max(0, entry.rosteredMinutes - entry.bookedMinutesRostered);
  }

  const doctorRows = [...doctors.values()].sort((a, b) => b.rosteredMinutes - a.rosteredMinutes);

  const bySpecialty = new Map<string, SpecialtyMetrics>();
  for (const entry of doctorRows) {
    const key = entry.mainSpecialty;
    let row = bySpecialty.get(key);
    if (!row) {
      row = {
        specialty: key,
        doctors: 0,
        rosteredMinutes: 0,
        booked: 0,
        completed: 0,
        canceled: 0,
        noShow: 0,
        inProgress: 0,
        notRostered: 0,
        bookedMinutesRostered: 0,
        completedMinutesRostered: 0,
        utilisation: null,
        yield: null,
      };
      bySpecialty.set(key, row);
    }
    row.doctors++;
    row.rosteredMinutes += entry.rosteredMinutes;
    row.booked += entry.booked;
    row.completed += entry.completed;
    row.canceled += entry.canceled;
    row.noShow += entry.noShow;
    row.inProgress += entry.inProgress;
    row.notRostered += entry.notRostered;
    row.bookedMinutesRostered += entry.bookedMinutesRostered;
    row.completedMinutesRostered += entry.completedMinutesRostered;
  }
  for (const row of bySpecialty.values()) {
    row.utilisation = ratio(row.bookedMinutesRostered, row.rosteredMinutes);
    row.yield = ratio(row.completedMinutesRostered, row.rosteredMinutes);
  }

  const totals = doctorRows.reduce<CapacityTotals>(
    (sum, entry) => {
      sum.rosteredMinutes += entry.rosteredMinutes;
      sum.booked += entry.booked;
      sum.completed += entry.completed;
      sum.canceled += entry.canceled;
      sum.noShow += entry.noShow;
      sum.inProgress += entry.inProgress;
      sum.notRostered += entry.notRostered;
      sum.bookedMinutesRostered += entry.bookedMinutesRostered;
      sum.completedMinutesRostered += entry.completedMinutesRostered;
      return sum;
    },
    {
      rosteredMinutes: 0,
      doctors: doctorRows.length,
      daysCovered: dates.size,
      booked: 0,
      completed: 0,
      canceled: 0,
      noShow: 0,
      inProgress: 0,
      notRostered: 0,
      bookedMinutesRostered: 0,
      completedMinutesRostered: 0,
      utilisation: null,
      yield: null,
      idleMinutes: 0,
    },
  );
  totals.utilisation = ratio(totals.bookedMinutesRostered, totals.rosteredMinutes);
  totals.yield = ratio(totals.completedMinutesRostered, totals.rosteredMinutes);
  totals.idleMinutes = Math.max(0, totals.rosteredMinutes - totals.bookedMinutesRostered);

  return {
    totals,
    doctors: doctorRows,
    specialties: [...bySpecialty.values()].sort((a, b) => b.rosteredMinutes - a.rosteredMinutes),
  };
}

export interface DayPoint {
  date: string;
  rosteredMinutes: number;
  bookedMinutesRostered: number;
  completedMinutesRostered: number;
  booked: number;
  completed: number;
  canceled: number;
  noShow: number;
  utilisation: number | null;
  yield: number | null;
}

/**
 * The same measures, one point per day.
 *
 * Built by partitioning the rows already fetched rather than by calling analyse
 * once per date: the date is part of the group key, so a single pass gives
 * every day and there is no N+1 query behind the trend line.
 */
export function analyseByDay(
  shifts: ShiftInput[],
  groups: AppointmentGroup[],
  config: CapacityConfig = DEFAULT_CAPACITY_CONFIG,
): DayPoint[] {
  const days = new Map<string, DayPoint>();
  const rosteredDays = new Set<string>();

  const ensure = (date: string): DayPoint => {
    let point = days.get(date);
    if (!point) {
      point = {
        date,
        rosteredMinutes: 0,
        bookedMinutesRostered: 0,
        completedMinutesRostered: 0,
        booked: 0,
        completed: 0,
        canceled: 0,
        noShow: 0,
        utilisation: null,
        yield: null,
      };
      days.set(date, point);
    }
    return point;
  };

  for (const shift of shifts) {
    ensure(shift.date).rosteredMinutes += Math.max(0, shift.endMin - shift.startMin);
    rosteredDays.add(`${shift.doctorId}|${shift.date}`);
  }

  for (const group of groups) {
    const point = ensure(group.date);
    const minutes = slotMinutes(group.apptType, config) * group.count;
    point.booked += group.count;

    if (group.statusBucket === 'canceled') point.canceled += group.count;
    else if (group.statusBucket === 'noshow') point.noShow += group.count;
    else point.completed += group.count;

    // Same rule as analyse: a booking on an unrostered day has no minutes to
    // be measured against, so it never enters the ratio.
    if (rosteredDays.has(`${group.doctorId}|${group.date}`)) {
      point.bookedMinutesRostered += minutes;
      if (group.statusBucket !== 'canceled' && group.statusBucket !== 'noshow') {
        point.completedMinutesRostered += minutes;
      }
    }
  }

  for (const point of days.values()) {
    point.utilisation = ratio(point.bookedMinutesRostered, point.rosteredMinutes);
    point.yield = ratio(point.completedMinutesRostered, point.rosteredMinutes);
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
