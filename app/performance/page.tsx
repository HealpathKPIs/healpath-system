import FilterBar from '@/components/FilterBar';
import { ExecutiveScenarioLayer } from '@/components/ExecutiveExperience';
import { getDiagnostics, getDrugs, getKpis, getPerformanceEntityMetrics, getTrends, listDoctors, listSpecialties, resolveFilters } from '@/lib/queries';
import PerformanceMatrixClient, { type MatrixCell, type MatrixRow, type MatrixTab } from './PerformanceMatrixClient';
import { Suspense } from 'react';

const MONTH_LABEL: Record<string, string> = {
  '2026-01': 'Jan',
  '2026-02': 'Feb',
  '2026-03': 'Mar',
  '2026-04': 'Apr',
  '2026-05': 'May',
  '2026-06': 'Jun',
};

function monthLabel(value: string) {
  if (MONTH_LABEL[value]) return MONTH_LABEL[value];
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date);
}

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function summarize(cells: MatrixCell[]) {
  const active = cells.filter((cell) => cell.visits > 0);
  const visits = active.reduce((sum, cell) => sum + cell.visits, 0);
  const avg = (key: 'avgMeds' | 'avgLabs' | 'avgScans') => {
    if (!active.length) return 0;
    return active.reduce((sum, cell) => sum + cell[key], 0) / active.length;
  };
  return { visits, avgMeds: avg('avgMeds'), avgLabs: avg('avgLabs'), avgScans: avg('avgScans') };
}

async function buildRows(tab: MatrixTab, entities: string[], months: string[], base: any): Promise<MatrixRow[]> {
  const metrics = await getPerformanceEntityMetrics(tab, entities, months, base);
  return entities.map((entity) => {
    const cells = months.map((month) => {
      const k = metrics.find((row) => row.entity === entity && row.month === month) ?? {
        visits: 0,
        avgMeds: 0,
        avgLabs: 0,
        avgScans: 0,
      };
      return {
        month,
        monthLabel: MONTH_LABEL[month] ?? month,
        visits: k.visits,
        avgMeds: k.avgMeds,
        avgLabs: k.avgLabs,
        avgScans: k.avgScans,
      };
    });
    return {
      id: `${tab}-${entity}`,
      entity,
      display: tab === 'medications' ? titleCase(entity) : entity,
      tab,
      cells,
      summary: summarize(cells),
    };
  });
}

function bestCell(rows: MatrixRow[], metric: 'visits' | 'avgMeds' | 'avgLabs' | 'avgScans') {
  return rows.flatMap((row) => row.cells.map((cell) => ({ row, cell })))
    .sort((a, b) => b.cell[metric] - a.cell[metric])[0] ?? null;
}

function fmt(metric: 'visits' | 'avgMeds' | 'avgLabs' | 'avgScans', value: number) {
  return metric === 'visits' ? value.toLocaleString() : value.toFixed(2);
}

export default async function PerformanceMatrix({ searchParams }: {
  searchParams: { month?: string; specialty?: string; doctor?: string; sel?: string; selv?: string; q?: string };
}) {
  const f = resolveFilters(searchParams, { doctor: true, drug: true, disease: true });

  const [k, drugs, diagnostics, trends, peerKpis] = await Promise.all([
    getKpis(f),
    getDrugs(f),
    getDiagnostics(f),
    getTrends(f.specialty, f.doctor, f.drug, f.disease),
    f.doctor ? getKpis({ ...f, doctor: null }) : Promise.resolve(null),
  ]);
  const allMonths = trends.points.map((point) => point.month);
  const months = f.month ? [f.month].filter((month) => allMonths.includes(month)) : allMonths;
  const safeMonths = months.length ? months : allMonths;

  const doctors = f.doctor ? [f.doctor] : listDoctors();
  const specialties = f.specialty ? [f.specialty] : listSpecialties();
  const medications = (f.drug ? [f.drug] : drugs.ac.map((row) => row.label)).slice(0, 15);
  const laboratories = diagnostics.labs.map((row) => row.label).slice(0, 10);
  const scans = diagnostics.scans.map((row) => row.label).slice(0, 10);

  const [doctorRows, specialtyRows, medicationRows, laboratoryRows, scanRows] = await Promise.all([
    buildRows('doctors', doctors, safeMonths, f),
    buildRows('specialties', specialties, safeMonths, f),
    buildRows('medications', medications, safeMonths, f),
    buildRows('laboratories', laboratories, safeMonths, f),
    buildRows('scans', scans, safeMonths, f),
  ]);

  const allRows = [...doctorRows, ...specialtyRows, ...medicationRows, ...laboratoryRows, ...scanRows];
  const cards = [
    { label: 'Highest Avg Medications', metric: 'avgMeds' as const },
    { label: 'Highest Avg Labs', metric: 'avgLabs' as const },
    { label: 'Highest Avg Scans', metric: 'avgScans' as const },
    { label: 'Highest Visits', metric: 'visits' as const },
  ].map((card) => {
    const best = bestCell(allRows, card.metric);
    return {
      label: card.label,
      value: best ? fmt(card.metric, best.cell[card.metric]) : '0',
      detail: best ? `${best.row.display} - ${best.cell.monthLabel}` : 'No data',
    };
  });

  return (
    <section style={{ display: 'grid', gap: 22 }}>
      <ExecutiveScenarioLayer k={k} doctor={f.doctor} peerKpis={peerKpis} drugs={drugs} diagnostics={diagnostics} trends={trends} />
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Performance Matrix</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Executive comparison across doctors, specialties, medications, laboratories, and scans.</p>
        </div>
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={allMonths} specialties={listSpecialties()} doctors={listDoctors()} />
        </Suspense>
      </div>
      <PerformanceMatrixClient
        months={safeMonths.map((month) => ({ key: month, label: monthLabel(month) }))}
        cards={cards}
        rows={{ doctors: doctorRows, specialties: specialtyRows, medications: medicationRows, laboratories: laboratoryRows, scans: scanRows }}
        initialSearch={searchParams.q ?? ''}
      />
    </section>
  );
}
