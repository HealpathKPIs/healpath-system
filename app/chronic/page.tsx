import AnimatedNumber from '@/components/AnimatedNumber';
import ChronicShortcuts from './ChronicShortcuts';
import ExecutiveChartDrill from './ExecutiveChartDrill';
import ExportCenter from './ExportCenter';
import KpiDrilldown from './KpiDrilldown';
import {
  getChronicPageData,
  type ChronicCatalogComparison,
  type ChronicComparisonMetric,
  type ChronicKpiDrilldowns,
  type ChronicOutcomeTrendPoint,
} from '@/lib/queries';
import Link from 'next/link';
import { Suspense } from 'react';

const selectStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '0 10px',
  font: 'inherit',
  fontSize: 13,
  minWidth: 140,
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  minWidth: 190,
};

function formatMetric(value: number, decimals = 0) {
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function trimFixed(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatExecutiveMetric(value: number, decimals = 0) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimFixed(value / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${trimFixed(value / 1_000, 1)}K`;
  return formatMetric(value, decimals);
}

function improvementBadge(metric: ChronicComparisonMetric) {
  if (metric.improvementPct > 0) {
    return { symbol: '▲', color: 'var(--success)', background: 'var(--success-soft)', border: 'rgba(5,150,105,.18)' };
  }
  if (metric.improvementPct < 0) {
    return { symbol: '▼', color: 'var(--danger)', background: 'var(--danger-soft)', border: 'rgba(225,29,72,.18)' };
  }
  return { symbol: '■', color: 'var(--text-muted)', background: 'var(--surface-3)', border: 'var(--border-soft)' };
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: string[] }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{label}</span>
      <select name={name} defaultValue={value} style={selectStyle}>
        <option value="">All</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ComparisonCard({ metric }: { metric: ChronicComparisonMetric }) {
  const decimals = metric.decimals ?? 0;
  const badge = improvementBadge(metric);
  const trendWidth = `${Math.min(100, Math.max(10, Math.abs(metric.improvementPct)))}%`;
  const trendSymbol = metric.improvementPct > 0 ? '▲' : metric.improvementPct < 0 ? '▼' : '■';
  const trendLabel = metric.improvementPct > 0 ? 'Improving' : metric.improvementPct < 0 ? 'Regressing' : 'Flat';
  return (
    <section className="card kpi-card chronic-exec-card" title={`${metric.label}: PRE ${formatMetric(metric.pre, decimals)}, POST ${formatMetric(metric.post, decimals)}`}>
      <div className="chronic-exec-card-body">
        <div className="chronic-exec-card-top">
          <div className="chronic-exec-title">{metric.label}</div>
          <span
            title={`Improvement ${metric.improvementPct.toFixed(1)}%`}
            className="chronic-exec-badge"
            style={{
              border: `1px solid ${badge.border}`,
              background: badge.background,
              color: badge.color,
            }}
          >
            <span aria-hidden="true" style={{ marginRight: 5 }}>{trendSymbol}</span>
            {metric.improvementPct.toFixed(1)}%
          </span>
        </div>
        <div className="chronic-exec-middle">
          <div className="chronic-exec-phase">
            <div className="chronic-exec-phase-label">PRE</div>
            <div className="chronic-exec-number">
              <AnimatedNumber value={formatExecutiveMetric(metric.pre, decimals)} />
            </div>
          </div>
          <div className="chronic-exec-phase">
            <div className="chronic-exec-phase-label">POST</div>
            <div className="chronic-exec-number">
              <AnimatedNumber value={formatExecutiveMetric(metric.post, decimals)} />
            </div>
          </div>
        </div>
        <div className="chronic-exec-card-bottom">
          <div>
            <span className="chronic-exec-bottom-label">Difference</span>
            <div className="chronic-exec-diff">{formatExecutiveMetric(metric.difference, decimals)}</div>
          </div>
          <div className="chronic-exec-trend" title={`${trendLabel}: ${metric.improvementPct.toFixed(1)}%`}>
            <span className="chronic-exec-bottom-label">Trend</span>
            <div className="chronic-exec-trend-track" aria-hidden="true">
              <div className="chronic-exec-trend-fill" style={{ width: trendWidth, background: badge.color }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
  return (
    <section className="card kpi-card" title={`${metric.label}: PRE ${formatMetric(metric.pre, decimals)}, POST ${formatMetric(metric.post, decimals)}`}>
      <div style={{ display: 'grid', gap: 16, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div className="kpi-label" style={{ lineHeight: 1.25 }}>{metric.label}</div>
          <span
            title={`Improvement ${metric.improvementPct.toFixed(1)}%`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              minHeight: 26,
              padding: '3px 9px',
              borderRadius: 999,
              border: `1px solid ${badge.border}`,
              background: badge.background,
              color: badge.color,
              fontSize: 12,
              fontWeight: 900,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true">{badge.symbol}</span>
            {metric.improvementPct.toFixed(1)}%
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>PRE</div>
            <div className="kpi-value" style={{ fontSize: 34, lineHeight: 1, letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
              <AnimatedNumber value={formatExecutiveMetric(metric.pre, decimals)} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>POST</div>
            <div className="kpi-value" style={{ fontSize: 34, lineHeight: 1, letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
              <AnimatedNumber value={formatExecutiveMetric(metric.post, decimals)} />
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 4, borderTop: '1px solid var(--border-soft)', paddingTop: 12, fontVariantNumeric: 'tabular-nums' }}>
          <span className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>Difference</span>
          <b style={{ color: 'var(--text)', fontSize: 18, lineHeight: 1.1 }}>{formatExecutiveMetric(metric.difference, decimals)}</b>
        </div>
      </div>
    </section>
  );
}

function OutcomeChart({ title, points, preKey, postKey, improvementKey, drilldowns }: {
  title: string;
  points: ChronicOutcomeTrendPoint[];
  preKey: 'preIssuesPerPatient' | 'preRecommendationsPerPatient';
  postKey: 'postIssuesPerPatient' | 'postRecommendationsPerPatient';
  improvementKey: 'issueImprovementPct' | 'recommendationImprovementPct';
  drilldowns: ChronicKpiDrilldowns;
}) {
  if (!points.length) {
    return (
      <section className="card">
        <p className="section-title">{title}</p>
        <div className="chart-empty">No PRE vs POST outcome data for the selected filters</div>
      </section>
    );
  }
  const width = 560;
  const height = 220;
  const left = 40;
  const right = 18;
  const top = 20;
  const bottom = 36;
  const values = points.flatMap((point) => [point[preKey], point[postKey]]);
  const max = Math.max(...values, 1);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const coords = (key: typeof preKey | typeof postKey) => points.map((point, index) => {
    const x = left + index * ((width - left - right) / Math.max(points.length - 1, 1));
    const y = top + (1 - ((point[key] - min) / span)) * (height - top - bottom);
    return { x, y, point, value: point[key] };
  });
  const pre = coords(preKey);
  const post = coords(postKey);
  const line = (items: typeof pre) => items.map((item) => `${item.x},${item.y}`).join(' ');
  const latest = points[points.length - 1];
  const drillData = {
    kind: 'line' as const,
    series: [
      { label: 'PRE', color: 'var(--warning)', values: points.map((point) => ({ label: point.period, value: point[preKey] })) },
      { label: 'POST', color: 'var(--accent)', values: points.map((point) => ({ label: point.period, value: point[postKey] })) },
    ],
  };

  return (
    <ExecutiveChartDrill title={title} data={drillData} drilldowns={drilldowns}>
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <p className="section-title">{title}</p>
          <span style={{ color: latest[improvementKey] >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>
            Improvement {latest[improvementKey].toFixed(1)}%
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
          {[0, 1, 2, 3].map((tick) => {
            const y = top + tick * ((height - top - bottom) / 3);
            return <line key={tick} x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border-soft)" strokeDasharray="4 4" />;
          })}
          <polyline points={line(pre)} fill="none" stroke="var(--warning)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={line(post)} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {[...pre.map((item) => ({ ...item, key: 'PRE', color: 'var(--warning)' })), ...post.map((item) => ({ ...item, key: 'POST', color: 'var(--accent)' }))].map(({ x, y, point, value, key, color }) => (
            <g key={`${point.period}-${key}-${value}`}>
              <title>{`${point.period}\n${key}: ${value.toFixed(2)}`}</title>
              <circle cx={x} cy={y} r="9" fill="transparent" pointerEvents="all" />
              <circle cx={x} cy={y} r="3.8" fill={color} stroke="var(--surface)" strokeWidth="2" />
            </g>
          ))}
          {pre.map(({ x, point }, index) => index % Math.ceil(pre.length / 5 || 1) === 0 ? (
            <text key={point.period} x={x} y={height - 9} textAnchor="middle" fontSize="10" fill="var(--text-soft)" fontWeight="700">{point.period}</text>
          ) : null)}
        </svg>
        <div className="trend-legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: 'var(--warning)' }} />PRE</span>
          <span><i style={{ background: 'var(--accent)' }} />POST</span>
        </div>
      </section>
    </ExecutiveChartDrill>
  );
}

function ComparisonTable({ title, rows }: { title: string; rows: ChronicCatalogComparison[] }) {
  if (!rows.length) {
    return (
      <section className="card">
        <p className="section-title">{title}</p>
        <div className="table-empty">No catalog rows for the selected filters</div>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="section-title">{title}</p>
      <div className="chronic-table-wrap">
        <table className="chronic-table">
          <thead>
            <tr>
              {['Category', 'PRE Count', 'POST Count', 'Difference', 'Improvement %'].map((header, index) => (
                <th key={header} style={{ textAlign: index === 0 ? 'left' : 'right', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.label}</td>
                <td style={cellStyle}>{row.pre.toLocaleString()}</td>
                <td style={cellStyle}>{row.post.toLocaleString()}</td>
                <td style={cellStyle}>{row.difference.toLocaleString()}</td>
                <td style={{ ...cellStyle, color: row.improvementPct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 850 }}>{row.improvementPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cellStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '11px 8px',
  borderBottom: '1px solid var(--border-soft)',
  fontVariantNumeric: 'tabular-nums',
};

function OperationalCard({ label, value, suffix = '', decimals = 0 }: { label: string; value: number; suffix?: string; decimals?: number }) {
  const display = suffix ? formatMetric(value, decimals) : formatExecutiveMetric(value, decimals);
  return (
    <section className="card kpi-card chronic-exec-card chronic-exec-operational" title={`${label}: ${formatMetric(value, decimals)}${suffix}`}>
      <div className="chronic-exec-card-body">
        <div className="chronic-exec-card-top">
          <div className="chronic-exec-title">{label}</div>
          <span className="chronic-exec-badge" style={{ color: 'var(--text-muted)', background: 'var(--surface-3)', border: '1px solid var(--border-soft)' }}>
            Current
          </span>
        </div>
        <div className="chronic-exec-middle">
          <div className="chronic-exec-phase">
            <div className="chronic-exec-phase-label">Value</div>
            <div className="chronic-exec-number">
              <AnimatedNumber value={display} />{suffix}
            </div>
          </div>
        </div>
        <div className="chronic-exec-card-bottom">
          <div>
            <span className="chronic-exec-bottom-label">Difference</span>
            <div className="chronic-exec-diff">Filtered scope</div>
          </div>
          <div className="chronic-exec-trend">
            <span className="chronic-exec-bottom-label">Trend</span>
            <div className="chronic-exec-trend-track" aria-hidden="true">
              <div className="chronic-exec-trend-fill" style={{ width: '44%', background: 'var(--text-soft)' }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
  return (
    <section className="card kpi-card" title={`${label}: ${formatMetric(value, decimals)}${suffix}`}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="kpi-label" style={{ lineHeight: 1.25 }}>{label}</div>
        <div className="kpi-value" style={{ fontSize: 36, lineHeight: 1, letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
          <AnimatedNumber value={display} />{suffix}
        </div>
      </div>
    </section>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <div className="grid kpirow">
      {Array.from({ length: count }).map((_, index) => (
        <div className="card kpi-card" key={index}>
          <div className="skeleton-line" style={{ width: 96, height: 12 }} />
          <div className="skeleton-line" style={{ width: 120, height: 34, marginTop: 14 }} />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="grid chronic-chart-grid">
      <div className="card"><div className="skeleton-block" style={{ height: 220 }} /></div>
      <div className="card"><div className="skeleton-block" style={{ height: 220 }} /></div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="card">
      <div className="skeleton-line" style={{ width: 180, height: 14 }} />
      <div className="skeleton-block" style={{ height: 220, marginTop: 14 }} />
    </div>
  );
}

async function HeaderSubtitle({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  const periodSuffix = data.currentPeriod ? ` - ${data.currentPeriod}` : '';
  return (
    <p className="muted" style={{ margin: '8px 0 0' }}>
      PRE vs POST clinical outcome dashboard{periodSuffix}.
    </p>
  );
}

async function ChronicFilters({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return (
    <form id="chronic-filters" className="filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }} aria-describedby="chronic-keyboard-shortcuts">
      <FilterSelect name="period" label="Period" value={data.filters.period ?? ''} options={data.options.periods} />
      <FilterSelect name="consultant" label="Consultant" value={data.filters.consultant ?? ''} options={data.options.consultants} />
      <FilterSelect name="issue" label="Issue" value={data.filters.issue ?? ''} options={data.options.issues} />
      <FilterSelect name="recommendation" label="Recommendation" value={data.filters.recommendation ?? ''} options={data.options.recommendations} />
      <label style={{ display: 'grid', gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>Patient Search</span>
        <input id="chronic-patient-search" name="patient" defaultValue={data.filters.patient ?? ''} placeholder="Patient ID" style={inputStyle} aria-label="Patient ID search" />
      </label>
      <button type="submit" style={{ height: 38, border: 0, borderRadius: 10, padding: '0 16px', background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Apply</button>
      <a href="/chronic" style={{ height: 38, display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '0 14px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700 }}>Clear</a>
    </form>
  );
}

async function ChronicExportSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return <ExportCenter data={data} />;
}

async function ExecutiveComparisonSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return (
    <div className="grid kpirow chronic-exec-grid">
      {data.prePost.metrics.map((metric) => (
        <KpiDrilldown key={metric.label} title={metric.label} steps={data.drilldowns[metric.label] ?? []}>
          <ComparisonCard metric={metric} />
        </KpiDrilldown>
      ))}
    </div>
  );
}

async function ClinicalOutcomeSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return (
    <div className="grid chronic-chart-grid">
      <OutcomeChart
        title="Issues per Patient"
        points={data.prePost.outcomeTrends}
        preKey="preIssuesPerPatient"
        postKey="postIssuesPerPatient"
        improvementKey="issueImprovementPct"
        drilldowns={data.drilldowns}
      />
      <OutcomeChart
        title="Recommendations per Patient"
        points={data.prePost.outcomeTrends}
        preKey="preRecommendationsPerPatient"
        postKey="postRecommendationsPerPatient"
        improvementKey="recommendationImprovementPct"
        drilldowns={data.drilldowns}
      />
    </div>
  );
}

async function IssueComparisonSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return <ComparisonTable title="Fixed Issue Catalog" rows={data.prePost.issueCatalog} />;
}

async function RecommendationComparisonSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  return <ComparisonTable title="Fixed Recommendation Catalog" rows={data.prePost.recommendationCatalog} />;
}

async function OperationalKpiSection({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  const data = await getChronicPageData(searchParams);
  const operational = data.prePost.operational;
  return (
    <div className="grid kpirow">
      <KpiDrilldown title="Waiting Lab" steps={data.drilldowns['Waiting Lab'] ?? []}>
        <OperationalCard label="Waiting Lab" value={operational.waitingLab} />
      </KpiDrilldown>
      <KpiDrilldown title="No Need For Chronic" steps={data.drilldowns['No Need For Chronic'] ?? []}>
        <OperationalCard label="No Need For Chronic" value={operational.noNeedForChronic} />
      </KpiDrilldown>
      <KpiDrilldown title="No Need %" steps={data.drilldowns['No Need %'] ?? []}>
        <OperationalCard label="No Need %" value={operational.noNeedPct} suffix="%" decimals={2} />
      </KpiDrilldown>
    </div>
  );
}

export default function ChronicCarePage({ searchParams }: {
  searchParams: { period?: string; consultant?: string; recommendation?: string; issue?: string; patient?: string };
}) {
  return (
    <section className="chronic-dashboard">
      <ChronicShortcuts />
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Chronic Care</h1>
          <Suspense fallback={<p className="muted" style={{ margin: '8px 0 0' }}>PRE vs POST clinical outcome dashboard.</p>}>
            <HeaderSubtitle searchParams={searchParams} />
          </Suspense>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Link
            href="/chronic/analytics"
            aria-label="Open Chronic Intelligence Center analytics"
            style={{
              height: 38,
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0 14px',
              color: 'var(--text)',
              background: 'var(--surface)',
              textDecoration: 'none',
              fontWeight: 800,
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            Analytics
          </Link>
          <Link
            href="/chronic/patient"
            aria-label="Open Patient Explorer"
            style={{
              height: 38,
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0 14px',
              color: 'var(--text)',
              background: 'var(--surface)',
              textDecoration: 'none',
              fontWeight: 800,
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            Patient
          </Link>
          <Link
            href="/chronic/import"
            aria-label="Open Chronic Import Center"
            style={{
              height: 38,
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0 14px',
              color: 'var(--text)',
              background: 'var(--surface)',
              textDecoration: 'none',
              fontWeight: 800,
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            Import
          </Link>
        </div>
      </div>

      <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 760, maxWidth: '100%', height: 38 }} /></div>}>
        <ChronicFilters searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<div className="card"><div className="skeleton-line" style={{ width: 180, height: 14 }} /><div className="skeleton-line" style={{ width: 420, maxWidth: '100%', height: 12, marginTop: 12 }} /></div>}>
        <ChronicExportSection searchParams={searchParams} />
      </Suspense>

      <section id="chronic-executive-comparison" tabIndex={-1} className="chronic-section" aria-labelledby="chronic-executive-comparison-title">
        <p id="chronic-executive-comparison-title" className="section-title">Executive Comparison</p>
        <Suspense fallback={<CardSkeleton count={7} />}>
          <ExecutiveComparisonSection searchParams={searchParams} />
        </Suspense>
      </section>

      <section id="chronic-clinical-outcome" tabIndex={-1} className="chronic-section" aria-labelledby="chronic-clinical-outcome-title">
        <p id="chronic-clinical-outcome-title" className="section-title">Clinical Outcome</p>
        <Suspense fallback={<ChartSkeleton />}>
          <ClinicalOutcomeSection searchParams={searchParams} />
        </Suspense>
      </section>

      <section id="chronic-issue-comparison" tabIndex={-1} className="chronic-section" aria-labelledby="chronic-issue-comparison-title">
        <p id="chronic-issue-comparison-title" className="section-title">Issue Comparison</p>
        <Suspense fallback={<TableSkeleton />}>
          <IssueComparisonSection searchParams={searchParams} />
        </Suspense>
      </section>

      <section id="chronic-recommendation-comparison" tabIndex={-1} className="chronic-section" aria-labelledby="chronic-recommendation-comparison-title">
        <p id="chronic-recommendation-comparison-title" className="section-title">Recommendation Comparison</p>
        <Suspense fallback={<TableSkeleton />}>
          <RecommendationComparisonSection searchParams={searchParams} />
        </Suspense>
      </section>

      <section id="chronic-operational-kpis" tabIndex={-1} className="chronic-section" aria-labelledby="chronic-operational-kpis-title">
        <p id="chronic-operational-kpis-title" className="section-title">Operational KPIs</p>
        <Suspense fallback={<CardSkeleton count={3} />}>
          <OperationalKpiSection searchParams={searchParams} />
        </Suspense>
      </section>
    </section>
  );
}
