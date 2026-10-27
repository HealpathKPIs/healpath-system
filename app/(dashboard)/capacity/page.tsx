import DataSourceStatus from '@/components/DataSourceStatus';
import DataTable from '@/components/DataTable';
import KpiCard from '@/components/KpiCard';
import CapacityRangeBar from '@/components/capacity/CapacityRangeBar';
import { analyse } from '@/lib/capacity/engine';
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
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const last = new Date(year, monthIndex, 0).getDate();
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
  const { totals } = result;

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
    inProgress: row.inProgress,
    notRostered: row.notRostered,
    utilisation: row.utilisation == null ? 0 : Number(row.utilisation.toFixed(1)),
    yieldPct: row.yield == null ? 0 : Number(row.yield.toFixed(1)),
  }));

  // Advisories ship with the first version on purpose. A utilisation figure
  // with no statement of what it could not see is a number nobody can defend.
  const notices: string[] = [];
  if (totals.notRostered > 0) {
    notices.push(
      `${totals.notRostered.toLocaleString()} appointments fall on days the doctor has no shift in the schedule. ` +
        'They are counted in the totals but excluded from utilisation and yield, because there are no rostered minutes to divide by.',
    );
  }
  const unassigned = result.doctors.filter((row) => row.specialty === 'Unassigned').length;
  if (unassigned > 0) {
    notices.push(
      `${unassigned} ${unassigned === 1 ? 'doctor has' : 'doctors have'} no specialty. ` +
        'The appointment export carries no specialty column, so it is only known for doctors who appear in a schedule.',
    );
  }
  const noShifts = result.doctors.filter((row) => row.rosteredMinutes === 0).length;
  if (noShifts > 0) {
    notices.push(
      `${noShifts} ${noShifts === 1 ? 'doctor has' : 'doctors have'} bookings but no rostered time in this range.`,
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

      <div className="grid kpirow" style={{ marginBottom: 20 }}>
        <KpiCard label="Rostered hours" value={hours(totals.rosteredMinutes).toFixed(1)} />
        <KpiCard label="Utilisation" value={pct(totals.utilisation)} />
        <KpiCard label="Yield" value={pct(totals.yield)} />
        <KpiCard label="Booked, not completed" value={totals.inProgress.toLocaleString()} />
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

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">
          By specialty · {range.from} to {range.to}
        </p>
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
            { key: 'inProgress', label: 'In progress', num: true },
            { key: 'notRostered', label: 'Not rostered', num: true },
            { key: 'utilisation', label: 'Utilisation %', num: true, decimals: 1 },
            { key: 'yieldPct', label: 'Yield %', num: true, decimals: 1 },
          ]}
        />
      </div>
    </>
  );
}
