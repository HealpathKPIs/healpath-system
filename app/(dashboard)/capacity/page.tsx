import DataSourceStatus from '@/components/DataSourceStatus';
import DataTable from '@/components/DataTable';
import CapacityRangeBar from '@/components/capacity/CapacityRangeBar';
import CapacityTrend from '@/components/capacity/CapacityTrend';
import SpecialtyBars from '@/components/capacity/SpecialtyBars';
import SplitBar from '@/components/capacity/SplitBar';
import StatTile from '@/components/capacity/StatTile';
import { analyse, analyseByDay } from '@/lib/capacity/engine';
import {
  defaultCapacityRange,
  getCapacityAppointmentGroups,
  getCapacityConfig,
  getCapacityCoverage,
  getCapacityShifts,
  type DateRange,
} from '@/lib/capacity/queries';

export const dynamic = 'force-dynamic';

const hours = (minutes: number) => minutes / 60;
const pct = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`);

interface SearchParams {
  from?: string;
  to?: string;
  month?: string;
}

/** A month in the global filter bridges to a range when none is given. */
function rangeFromMonth(month: string): DateRange | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  // UTC, so the day number cannot be shifted by the server's timezone.
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { from: `${match[1]}-${match[2]}-01`, to: `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}` };
}

export default async function Capacity({ searchParams }: { searchParams: SearchParams }) {
  const coverage = await getCapacityCoverage();
  const fallback = defaultCapacityRange(coverage);

  if (!fallback) {
    return (
      <>
        <div className="pagehead">
          <h1 className="pagetitle">Capacity</h1>
        </div>
        <div className="card">
          <p className="section-title">No capacity data yet</p>
          <p className="muted">
            Import a month of schedule workbooks and an appointment export from the Capacity import
            page, and the rostered hours, utilisation and yield will appear here.
          </p>
        </div>
      </>
    );
  }

  const fromMonth = searchParams.month ? rangeFromMonth(searchParams.month) : null;
  const range: DateRange = {
    from: searchParams.from ?? fromMonth?.from ?? fallback.from,
    to: searchParams.to ?? fromMonth?.to ?? fallback.to,
  };

  const [config, shifts, groups] = await Promise.all([
    getCapacityConfig(),
    getCapacityShifts(range),
    getCapacityAppointmentGroups(range),
  ]);

  const result = analyse(shifts, groups, config);
  const days = analyseByDay(shifts, groups, config);
  const { totals } = result;

  // Every part below is measured against the same rostered minutes the KPI
  // tiles use, which is what makes the four shares add to exactly 100%.
  const completedMin = totals.completedMinutesRostered;
  const lostMin = Math.max(0, totals.bookedMinutesRostered - completedMin);
  const slot = config.defaultSlotMinutes;
  const cancelledMin = Math.min(lostMin, totals.canceled * slot);
  const noShowMin = Math.max(0, lostMin - cancelledMin);
  const unbookedMin = Math.max(0, totals.rosteredMinutes - totals.bookedMinutesRostered);

  const specialtyRows = result.specialties.map((row) => ({
    specialty: row.specialty,
    doctors: row.doctors,
    rostered: Number(hours(row.rosteredMinutes).toFixed(1)),
    booked: row.booked,
    completed: row.completed,
    notRostered: row.notRostered,
    utilisation: row.utilisation == null ? 0 : Number(row.utilisation.toFixed(1)),
    yieldPct: row.yield == null ? 0 : Number(row.yield.toFixed(1)),
  }));

  const doctorRows = result.doctors.map((row) => ({
    doctor: row.doctor,
    specialty: row.specialty,
    rostered: Number(hours(row.rosteredMinutes).toFixed(1)),
    days: row.daysRostered,
    booked: row.booked,
    completed: row.completed,
    notRostered: row.notRostered,
    utilisation: row.utilisation == null ? 0 : Number(row.utilisation.toFixed(1)),
    yieldPct: row.yield == null ? 0 : Number(row.yield.toFixed(1)),
  }));

  // Advisories ship alongside the numbers on purpose. A utilisation figure with
  // no statement of what it could not see is a number nobody can defend.
  const notices: string[] = [];
  if (totals.notRostered > 0) {
    notices.push(
      `${totals.notRostered.toLocaleString()} appointments fall on days the doctor has no shift in the schedule. ` +
        'They are counted in the totals but excluded from utilisation and yield, because there are no rostered minutes to divide by.',
    );
  }
  if (totals.inProgress > 0) {
    notices.push(
      `${totals.inProgress.toLocaleString()} appointments are still marked Pending, Due or Waiting Room in the export. ` +
        'They are counted as completed here, on the basis that the visit happened and only the record was left open.',
    );
  }
  const unassigned = result.doctors.filter((row) => row.specialty === 'Unassigned').length;
  if (unassigned > 0) {
    notices.push(
      `${unassigned} ${unassigned === 1 ? 'doctor has' : 'doctors have'} no specialty. ` +
        'The appointment export carries no specialty column, so it is only known for doctors who appear in a schedule.',
    );
  }
  const emptyDays = days.filter((day) => day.rosteredMinutes > 0 && day.booked === 0).length;
  if (emptyDays > 0) {
    notices.push(
      `${emptyDays} ${emptyDays === 1 ? 'day has' : 'days have'} rostered time but no appointments at all, ` +
        'which usually means the export stops before the schedule does. Narrow the range to compare like with like.',
    );
  }

  return (
    <>
      <div className="pagehead">
        <h1 className="pagetitle">Capacity</h1>
        <CapacityRangeBar
          from={range.from}
          to={range.to}
          min={coverage.scheduleStart ?? coverage.appointmentsStart}
          max={coverage.scheduleEnd ?? coverage.appointmentsEnd}
        />
      </div>

      <DataSourceStatus />

      <div className="cap-tile-row">
        <StatTile
          label="Rostered hours"
          value={hours(totals.rosteredMinutes).toFixed(0)}
          foot={`${totals.doctors} doctors · ${days.length} days`}
          trend={days.map((day) => hours(day.rosteredMinutes))}
          color="var(--cap-util)"
        />
        <StatTile
          label="Utilisation"
          value={pct(totals.utilisation)}
          foot="booked time ÷ rostered time"
          trend={days.map((day) => day.utilisation ?? 0)}
          color="var(--cap-util)"
        />
        <StatTile
          label="Yield"
          value={pct(totals.yield)}
          foot="completed time ÷ rostered time"
          trend={days.map((day) => day.yield ?? 0)}
          color="var(--cap-yield)"
        />
        <StatTile
          label="Cancelled + no-show"
          value={(totals.canceled + totals.noShow).toLocaleString()}
          foot={`${(((totals.canceled + totals.noShow) / Math.max(1, totals.booked)) * 100).toFixed(1)}% of bookings`}
          trend={days.map((day) => day.canceled + day.noShow)}
          color="var(--cap-cancelled)"
        />
      </div>

      {notices.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="section-title">Worth knowing about these numbers</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notices.map((notice) => (
              <li key={notice} className="muted" style={{ marginBottom: 6 }}>
                {notice}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lead" style={{ marginBottom: 20 }}>
        <div className="card">
          <p className="section-title">Where the rostered hours went</p>
          <SplitBar
            totalMinutes={totals.rosteredMinutes}
            segments={[
              { key: 'completed', label: 'Completed', minutes: completedMin, color: 'var(--cap-completed)' },
              { key: 'cancelled', label: 'Cancelled', minutes: cancelledMin, color: 'var(--cap-cancelled)' },
              { key: 'noshow', label: 'No-show', minutes: noShowMin, color: 'var(--cap-noshow)' },
              { key: 'unbooked', label: 'Never booked', minutes: unbookedMin, color: 'var(--cap-unbooked)' },
            ]}
          />
        </div>
        <div className="card">
          <p className="section-title">Utilisation by specialty</p>
          <SpecialtyBars
            rows={result.specialties.slice(0, 10).map((row) => ({
              label: row.specialty,
              value: row.utilisation,
              rosteredMinutes: row.rosteredMinutes,
              doctors: row.doctors,
            }))}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">
          Day by day · {range.from} to {range.to}
        </p>
        <CapacityTrend
          points={days.map((day) => ({ date: day.date, utilisation: day.utilisation, yield: day.yield }))}
        />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">By specialty</p>
        <DataTable
          rows={specialtyRows}
          columns={[
            { key: 'specialty', label: 'Specialty' },
            { key: 'doctors', label: 'Doctors', num: true },
            { key: 'rostered', label: 'Rostered h', num: true, decimals: 1 },
            { key: 'booked', label: 'Booked', num: true },
            { key: 'completed', label: 'Completed', num: true },
            { key: 'notRostered', label: 'Not rostered', num: true },
            { key: 'utilisation', label: 'Utilisation %', num: true, decimals: 1 },
            { key: 'yieldPct', label: 'Yield %', num: true, decimals: 1 },
          ]}
        />
      </div>

      <div className="card">
        <p className="section-title">By doctor</p>
        <DataTable
          searchable
          searchKey="doctor"
          rows={doctorRows}
          columns={[
            { key: 'doctor', label: 'Doctor' },
            { key: 'specialty', label: 'Specialty' },
            { key: 'rostered', label: 'Rostered h', num: true, decimals: 1 },
            { key: 'days', label: 'Days', num: true },
            { key: 'booked', label: 'Booked', num: true },
            { key: 'completed', label: 'Completed', num: true },
            { key: 'notRostered', label: 'Not rostered', num: true },
            { key: 'utilisation', label: 'Utilisation %', num: true, decimals: 1 },
            { key: 'yieldPct', label: 'Yield %', num: true, decimals: 1 },
          ]}
        />
      </div>
    </>
  );
}
