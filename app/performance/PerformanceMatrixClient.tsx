'use client';

import SearchBox from '@/components/SearchBox';
import { useDashboard } from '@/lib/dashboard-context';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState, type CSSProperties } from 'react';

export type MatrixTab = 'doctors' | 'specialties' | 'medications' | 'laboratories' | 'scans';
type Metric = 'visits' | 'avgMeds' | 'avgLabs' | 'avgScans';
type Direction = 'asc' | 'desc';

export interface MatrixCell {
  month: string;
  monthLabel: string;
  visits: number;
  avgMeds: number;
  avgLabs: number;
  avgScans: number;
}

export interface MatrixRow {
  id: string;
  entity: string;
  display: string;
  tab: MatrixTab;
  cells: MatrixCell[];
  summary: Record<Metric, number>;
}

const TABS: { key: MatrixTab; label: string; singular: string; searchScope: string }[] = [
  { key: 'doctors', label: 'Doctors', singular: 'Doctor', searchScope: 'doctors' },
  { key: 'specialties', label: 'Specialties', singular: 'Specialty', searchScope: 'doctors' },
  { key: 'medications', label: 'Medications', singular: 'Medication', searchScope: 'pharmacy' },
  { key: 'laboratories', label: 'Laboratories', singular: 'Laboratory', searchScope: 'diagnostics' },
  { key: 'scans', label: 'Scans', singular: 'Scan', searchScope: 'diagnostics' },
];

const METRICS: { key: Metric; label: string }[] = [
  { key: 'visits', label: 'Visits' },
  { key: 'avgMeds', label: 'Avg Medications' },
  { key: 'avgLabs', label: 'Avg Labs' },
  { key: 'avgScans', label: 'Avg Scans' },
];

function format(metric: Metric, value: number) {
  return metric === 'visits' ? value.toLocaleString() : value.toFixed(2);
}

function scenarioType(tab: MatrixTab) {
  if (tab === 'doctors') return 'Doctor';
  if (tab === 'specialties') return 'Specialty';
  if (tab === 'medications') return 'Medication';
  if (tab === 'laboratories') return 'Laboratory';
  return 'Scan';
}

export default function PerformanceMatrixClient({
  months,
  cards,
  rows,
  initialSearch,
}: {
  months: { key: string; label: string }[];
  cards: { label: string; value: string; detail: string }[];
  rows: Record<MatrixTab, MatrixRow[]>;
  initialSearch: string;
}) {
  const params = useSearchParams();
  const { setSelection } = useDashboard();
  const [tab, setTab] = useState<MatrixTab>('doctors');
  const [metric, setMetric] = useState<Metric>('visits');
  const [sortMetric, setSortMetric] = useState<Metric>('visits');
  const [direction, setDirection] = useState<Direction>('desc');
  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];
  const query = (params.get('q') ?? initialSearch).trim().toLowerCase();

  const visibleRows = useMemo(() => {
    const filtered = rows[tab].filter((row) => !query || row.display.toLowerCase().includes(query) || row.entity.toLowerCase().includes(query));
    return [...filtered].sort((a, b) => {
      const delta = a.summary[sortMetric] - b.summary[sortMetric];
      return direction === 'asc' ? delta : -delta;
    });
  }, [direction, query, rows, sortMetric, tab]);

  const max = Math.max(1, ...visibleRows.flatMap((row) => row.cells.map((cell) => cell[metric])));

  function switchTab(next: MatrixTab) {
    setTab(next);
    if (next === 'laboratories' || next === 'scans') setMetric('visits');
  }

  function openScenario(row: MatrixRow) {
    if (row.tab === 'doctors') setSelection({ type: 'doctor', value: row.entity });
    else if (row.tab === 'specialties') setSelection({ type: 'specialty', value: row.entity });
    else if (row.tab === 'medications') setSelection({ type: 'drug', value: row.entity });
    else setSelection({ type: row.tab === 'laboratories' ? 'laboratory' : 'scan', value: row.entity } as any);
    window.dispatchEvent(new CustomEvent('healpath:scenario-open', {
      detail: { type: scenarioType(row.tab), name: row.display },
    }));
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="grid kpirow">
        {cards.map((card) => (
          <article key={card.label} className="card kpi-card">
            <div className="kpi-label">{card.label}</div>
            <div>
              <div className="kpi-value">{card.value}</div>
              <div className="muted" style={{ marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={card.detail}>{card.detail}</div>
            </div>
          </article>
        ))}
      </div>

      <section className="card" style={{ display: 'grid', gap: 16, overflow: 'visible' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="section-title" style={{ margin: 0 }}>Executive matrix</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TABS.map((item) => (
              <button key={item.key} type="button" onClick={() => switchTab(item.key)}
                style={{ height: 34, borderRadius: 9, border: '1px solid var(--border)', padding: '0 12px', cursor: 'pointer', background: tab === item.key ? 'var(--accent)' : 'var(--surface)', color: tab === item.key ? '#fff' : 'var(--text)', fontWeight: 700 }}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <SearchBox key={tab} scope={activeTab.searchScope} placeholder={`Search ${activeTab.label.toLowerCase()}...`} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label style={controlLabel}>
              Metric
              <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)} style={selectStyle}>
                {METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label style={controlLabel}>
              Sort by
              <select value={sortMetric} onChange={(event) => setSortMetric(event.target.value as Metric)} style={selectStyle}>
                {METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setDirection((value) => value === 'asc' ? 'desc' : 'asc')}
              style={{ alignSelf: 'end', height: 38, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '0 12px', cursor: 'pointer', fontWeight: 700 }}>
              {direction === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ overflow: 'auto', boxShadow: 'none' }}>
          <table style={{ minWidth: Math.max(760, 220 + months.length * 132) }}>
            <thead>
              <tr>
                <th style={{ left: 0, zIndex: 3, minWidth: 220 }}>Entity</th>
                {months.map((month) => <th key={month.key} className="num">{month.label}</th>)}
                <th className="num">Total / Avg</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', minWidth: 220 }}>
                    <button type="button" onClick={() => openScenario(row)}
                      style={{ width: '100%', display: 'grid', gap: 4, textAlign: 'left', border: 0, background: 'transparent', color: 'var(--text)', cursor: 'pointer', padding: 0 }}>
                      <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.display}</b>
                      <span style={{ color: 'var(--text-soft)', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{activeTab.singular}</span>
                    </button>
                  </td>
                  {row.cells.map((cell) => {
                    const intensity = Math.max(8, Math.round((cell[metric] / max) * 72));
                    return (
                      <td key={`${row.id}-${cell.month}`} className="num">
                        <span className="perf-cell" tabIndex={0}
                          style={{ background: `color-mix(in srgb, var(--accent-soft) ${intensity}%, var(--surface))`, borderColor: intensity > 46 ? 'var(--accent-border)' : 'var(--border-soft)' }}>
                          {format(metric, cell[metric])}
                          <span className="perf-tip" role="tooltip">
                            <b>{row.display}</b>
                            <span>{cell.monthLabel}</span>
                            <span>Visits <strong>{cell.visits.toLocaleString()}</strong></span>
                            <span>Avg Medications <strong>{cell.avgMeds.toFixed(2)}</strong></span>
                            <span>Avg Labs <strong>{cell.avgLabs.toFixed(2)}</strong></span>
                            <span>Avg Scans <strong>{cell.avgScans.toFixed(2)}</strong></span>
                          </span>
                        </span>
                      </td>
                    );
                  })}
                  <td className="num"><b>{format(metric, row.summary[metric])}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length ? <div className="table-empty">No data for the selected filters</div> : null}
        </div>
      </section>

      <style>{`
        .perf-cell {
          position: relative;
          display: inline-flex;
          justify-content: flex-end;
          min-width: 84px;
          border: 1px solid var(--border-soft);
          border-radius: 9px;
          padding: 7px 10px;
          color: var(--text-strong);
          font-weight: 750;
          font-variant-numeric: tabular-nums;
          transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
        }
        .perf-cell:hover,
        .perf-cell:focus-visible {
          border-color: var(--border-strong);
          box-shadow: var(--shadow-md);
          outline: none;
          transform: translateY(-1px);
        }
        .perf-tip {
          position: absolute;
          right: 0;
          bottom: calc(100% + 10px);
          z-index: 30;
          min-width: 230px;
          display: none;
          gap: 5px;
          padding: 12px 13px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          box-shadow: var(--shadow-lg);
          color: var(--text);
          text-align: left;
          font-size: 12px;
          font-weight: 650;
        }
        .perf-tip span {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          color: var(--text-soft);
        }
        .perf-tip strong { color: var(--text-strong); }
        .perf-cell:hover .perf-tip,
        .perf-cell:focus-visible .perf-tip {
          display: grid;
        }
      `}</style>
    </div>
  );
}

const selectStyle: CSSProperties = {
  height: 38,
  minWidth: 150,
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '0 10px',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 650,
};

const controlLabel: CSSProperties = {
  display: 'grid',
  gap: 5,
  color: 'var(--text-soft)',
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
};
