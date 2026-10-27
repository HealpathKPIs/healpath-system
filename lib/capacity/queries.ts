import { dbQuery, hasDb } from '@/lib/pg';

import {
  DEFAULT_CAPACITY_CONFIG,
  type AppointmentGroup,
  type CapacityConfig,
  type ShiftInput,
} from './engine';

/**
 * Reads for the capacity pages.
 *
 * Appointments are grouped in SQL before they reach Node. A quarter's worth of
 * raw rows is ~190k objects; grouped by (date, doctor, type, status) the same
 * period is a few tens of thousands of small scalars, which the engine folds in
 * well under a tenth of a second. The grouping is lossless for these metrics
 * because slot minutes are constant within a group.
 *
 * Every helper follows the house pattern from lib/queries.ts: guarded by
 * hasDb, wrapped in try/catch, and degrading to empty rather than throwing a
 * dashboard page.
 */

export interface DateRange {
  from: string;
  to: string;
}

export interface CapacityCoverage {
  scheduleStart: string | null;
  scheduleEnd: string | null;
  appointmentsStart: string | null;
  appointmentsEnd: string | null;
}

export async function getCapacityCoverage(): Promise<CapacityCoverage> {
  const empty: CapacityCoverage = {
    scheduleStart: null,
    scheduleEnd: null,
    appointmentsStart: null,
    appointmentsEnd: null,
  };
  if (!hasDb) return empty;
  try {
    const rows = await dbQuery<{
      schedule_start: string | null;
      schedule_end: string | null;
      appt_start: string | null;
      appt_end: string | null;
    }>(`
      select (select min(work_date)::text from healpath.capacity_schedule_shifts) as schedule_start,
             (select max(work_date)::text from healpath.capacity_schedule_shifts) as schedule_end,
             (select min(appt_date)::text  from healpath.capacity_appointments)    as appt_start,
             (select max(appt_date)::text  from healpath.capacity_appointments)    as appt_end
    `);
    const row = rows[0];
    if (!row) return empty;
    return {
      scheduleStart: row.schedule_start,
      scheduleEnd: row.schedule_end,
      appointmentsStart: row.appt_start,
      appointmentsEnd: row.appt_end,
    };
  } catch (error) {
    console.warn('capacity coverage query failed:', (error as Error).message);
    return empty;
  }
}

export async function getCapacityShifts(range: DateRange): Promise<ShiftInput[]> {
  if (!hasDb) return [];
  try {
    const rows = await dbQuery<{
      date: string;
      doctor_id: string;
      doctor_name: string;
      specialty: string | null;
      start_min: number;
      end_min: number;
    }>(
      `select s.work_date::text as date,
              s.practitioner_id as doctor_id,
              p.display_name as doctor_name,
              coalesce(sp.name, s.source_specialty_text) as specialty,
              s.start_min, s.end_min
         from healpath.capacity_schedule_shifts s
         join healpath.capacity_practitioners p on p.id = s.practitioner_id
         left join healpath.capacity_specialties sp on sp.id = s.specialty_id
        where s.work_date between $1 and $2`,
      [range.from, range.to],
    );
    return rows.map((row) => ({
      date: row.date,
      doctorId: Number(row.doctor_id),
      doctorName: row.doctor_name,
      specialty: row.specialty,
      startMin: Number(row.start_min),
      endMin: Number(row.end_min),
    }));
  } catch (error) {
    console.warn('capacity shifts query failed:', (error as Error).message);
    return [];
  }
}

export async function getCapacityAppointmentGroups(range: DateRange): Promise<AppointmentGroup[]> {
  if (!hasDb) return [];
  try {
    const rows = await dbQuery<{
      date: string;
      doctor_id: string;
      doctor_name: string;
      specialty: string | null;
      appt_type: string | null;
      status_bucket: AppointmentGroup['statusBucket'];
      n: number;
    }>(
      `select a.appt_date::text as date,
              a.practitioner_id as doctor_id,
              p.display_name as doctor_name,
              coalesce(sp.name, a.source_specialty_text) as specialty,
              a.appt_type,
              a.status_bucket,
              count(*)::int as n
         from healpath.capacity_appointments a
         join healpath.capacity_practitioners p on p.id = a.practitioner_id
         left join healpath.capacity_specialties sp on sp.id = a.specialty_id
        where a.appt_date between $1 and $2
        group by 1, 2, 3, 4, 5, 6`,
      [range.from, range.to],
    );
    return rows.map((row) => ({
      date: row.date,
      doctorId: Number(row.doctor_id),
      doctorName: row.doctor_name,
      specialty: row.specialty,
      apptType: row.appt_type,
      statusBucket: row.status_bucket,
      count: Number(row.n),
    }));
  } catch (error) {
    console.warn('capacity appointments query failed:', (error as Error).message);
    return [];
  }
}

/**
 * Settings plus the specialty parent map.
 *
 * The parent map is tri-state: a specialty with no row follows the automatic
 * "X & Y" rule, one flagged as overridden with no parent stands alone, and one
 * with a parent reports under it.
 */
export async function getCapacityConfig(): Promise<CapacityConfig> {
  if (!hasDb) return DEFAULT_CAPACITY_CONFIG;
  try {
    const [settings, specialties] = await Promise.all([
      dbQuery<{ key: string; value: unknown }>('select key, value from healpath.capacity_settings'),
      dbQuery<{ name: string; parent: string | null; overridden: boolean }>(
        `select s.name,
                parent.name as parent,
                s.parent_override_set as overridden
           from healpath.capacity_specialties s
           left join healpath.capacity_specialties parent on parent.id = s.parent_id
          where not s.hidden`,
      ),
    ]);

    const byKey = new Map(settings.map((row) => [row.key, row.value]));
    const overrides = new Map<string, string | null>();
    for (const row of specialties) {
      if (row.overridden) overrides.set(row.name, row.parent);
    }

    return {
      defaultSlotMinutes: Number(byKey.get('default_slot_minutes') ?? 15) || 15,
      amBoundaryMinutes: Number(byKey.get('am_boundary_minutes') ?? 720) || 720,
      specialties: { known: specialties.map((row) => row.name), overrides },
    };
  } catch (error) {
    console.warn('capacity config query failed:', (error as Error).message);
    return DEFAULT_CAPACITY_CONFIG;
  }
}

/**
 * Default to the whole calendar month the latest schedule covers.
 *
 * Reporting is done by month, so a month is what should open, and a rolling
 * window is the wrong shape: it cuts the first day or two off the month and
 * makes totals quietly disagree with every figure anyone has already circulated.
 *
 * The arithmetic is deliberately done on the date string rather than through
 * Date. An earlier version built the window with `new Date(...)` and
 * `toISOString()`, which converts local midnight to UTC: in a positive-offset
 * timezone the date rolls back a day and in UTC it does not, so the page showed
 * the full month on a developer's machine and silently dropped 1 October in
 * production. Nothing here needs a timezone, so nothing here uses one.
 */
export function defaultCapacityRange(coverage: CapacityCoverage): DateRange | null {
  const end = coverage.scheduleEnd ?? coverage.appointmentsEnd;
  if (!end) return null;

  const year = Number(end.slice(0, 4));
  const month = Number(end.slice(5, 7));
  // Day 0 of the next month is the last day of this one, and the Date is only
  // ever read for its day number, never formatted.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, '0');

  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}
