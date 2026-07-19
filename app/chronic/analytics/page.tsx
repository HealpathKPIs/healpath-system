import AnimatedNumber from '@/components/AnimatedNumber';
import BarRank from '@/components/BarRank';
import ExecutiveChartDrill from '../ExecutiveChartDrill';
import {
  getChronicOverview,
  type ChronicAnalyticsKpi,
  type ChronicBreakdownItem,
  type ChronicMedicationAnalytics,
  type ChronicRankedItem,
  type ChronicTrendPoint,
} from '@/lib/queries';
import Link from 'next/link';

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
  minWidth: 180,
};

const TREND_ARROW = { up: 'up', down: 'down', flat: 'flat' } as const;

function formatNumber(value: number, decimals = 0, suffix = '') {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
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

function AnalyticsKpi({ metric }: { metric: ChronicAnalyticsKpi }) {
  const value = formatNumber(metric.value, metric.decimals ?? 0);
  const display = `${value}${metric.suffix ?? ''}`;
  return (
    <section className="card kpi-card" title={`${metric.label}: ${display}`}>
      <div>
        <div className="kpi-label">{metric.label}</div>
        <div className="kpi-value"><AnimatedNumber value={value} />{metric.suffix ? <span>{metric.suffix}</span> : null}</div>
      </div>
    </section>
  );
}

function rankedRows(items: ChronicRankedItem[], limit = 10) {
  return items.slice(0, limit).map((item) => ({
    label: `${item.label} - ${item.pct.toFixed(1)}% ${TREND_ARROW[item.trend]}`,
    value: item.value,
  }));
}

function breakdownRows(items: ChronicBreakdownItem[]) {
  return items.map((item) => ({
    label: `${item.label} - ${item.pct.toFixed(1)}%`,
    value: item.value,
  }));
}

function TrendChart({ title, points, field, color }: {
  title: string;
  points: ChronicTrendPoint[];
  field: 'issues' | 'recommendations';
  color: string;
}) {
  if (!points.length) {
    return (
      <section className="card">
        <p className="section-title">{title}</p>
        <div className="chart-empty">No data for the selected filters</div>
      </section>
    );
  }
  const width = 520;
  const height = 190;
  const left = 38;
  const right = 14;
  const top = 18;
  const bottom = 32;
  const values = points.map((point) => point[field]);
  const max = Math.max(...values, 1);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = left + index * ((width - left - right) / Math.max(points.length - 1, 1));
    const y = top + (1 - ((point[field] - min) / span)) * (height - top - bottom);
    return { x, y, point, value: point[field] };
  });
  const polyline = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${left},${height - bottom} ${polyline} ${coords[coords.length - 1]?.x ?? left},${height - bottom}`;
  const drillData = {
    kind: 'line' as const,
    series: [
      {
        label: title,
        color,
        values: points.map((point) => ({ label: point.period, value: point[field] })),
      },
    ],
  };

  return (
    <ExecutiveChartDrill title={title} data={drillData}>
      <section className="card">
        <p className="section-title">{title}</p>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
          <polygon points={area} fill={color} opacity="0.10" />
          {[0, 1, 2, 3].map((tick) => {
            const y = top + tick * ((height - top - bottom) / 3);
            return <line key={tick} x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border-soft)" strokeDasharray="4 4" />;
          })}
          <polyline points={polyline} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {coords.map(({ x, y, point, value }) => (
            <g key={`${point.period}-${field}`}>
              <title>{`${point.period}\n${title}: ${value.toLocaleString()}`}</title>
              <circle cx={x} cy={y} r="9" fill="transparent" pointerEvents="all" />
              <circle cx={x} cy={y} r="3.8" fill={color} stroke="var(--surface)" strokeWidth="2" />
            </g>
          ))}
          {coords.map(({ x, point }, index) => index % Math.ceil(coords.length / 5 || 1) === 0 ? (
            <text key={point.period} x={x} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--text-soft)" fontWeight="700">{point.period}</text>
          ) : null)}
        </svg>
      </section>
    </ExecutiveChartDrill>
  );
}

function ChartCard({ title, rows, color }: { title: string; rows: { label: string; value: number }[]; color: string }) {
  return (
    <ExecutiveChartDrill title={title} data={{ kind: 'bar', rows, color }}>
      <section className="card">
        <p className="section-title">{title}</p>
        <BarRank data={rows} color={color} />
      </section>
    </ExecutiveChartDrill>
  );
}

function DistributionTiles({ title, rows, color }: { title: string; rows: ChronicBreakdownItem[]; color: string }) {
  const drillRows = rows.map((row) => ({ label: row.label, value: row.value, color }));
  return (
    <ExecutiveChartDrill title={title} data={{ kind: 'bar', rows: drillRows, color }}>
      <section className="card">
        <p className="section-title">{title}</p>
        {rows.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 180, alignContent: 'stretch' }}>
            {rows.slice(0, 10).map((row) => (
              <div
                key={row.label}
                title={`${row.label}: ${row.value.toLocaleString()} (${row.pct.toFixed(1)}%)`}
                style={{
                  flex: `${Math.max(row.value, 1)} 1 120px`,
                  minHeight: 74,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  padding: 12,
                  display: 'grid',
                  alignContent: 'space-between',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</b>
                <span style={{ color, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{row.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        ) : <div className="chart-empty">No data for the selected filters</div>}
      </section>
    </ExecutiveChartDrill>
  );
}

function CorrelationPairs({ pairs }: { pairs: Awaited<ReturnType<typeof getChronicOverview>>['analytics']['correlations'] }) {
  return (
    <section className="card">
      <p className="section-title">Most Common Issue to Recommendation Pairs</p>
      {pairs.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {pairs.map((pair, index) => (
            <div key={`${pair.issue}-${pair.recommendation}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: index === 0 ? 'var(--surface-2)' : 'var(--surface)' }}>
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pair.issue}>{pair.issue}</b>
              <span className="muted" style={{ textAlign: 'center', fontWeight: 900 }}>to</span>
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pair.recommendation}>{pair.recommendation}</b>
              <span className="rank-value" title={`${pair.pct.toFixed(1)}% of visible pairs`}>{pair.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : <div className="chart-empty">No issue and recommendation pairs for the selected filters</div>}
    </section>
  );
}

type ConsultantSort = 'patients' | 'recommendations' | 'issues' | 'recommendationPct' | 'issuePct' | 'avgMedications' | 'improvementPct';
type RankingSort = 'value' | 'label';

const CONSULTANT_HEADERS: { key: ConsultantSort; label: string }[] = [
  { key: 'patients', label: 'Patients' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'issues', label: 'Issues' },
  { key: 'recommendationPct', label: 'Recommendation %' },
  { key: 'issuePct', label: 'Issue %' },
  { key: 'avgMedications', label: 'Average Medications' },
  { key: 'improvementPct', label: 'Improvement %' },
];

function sortHref(searchParams: Record<string, string | undefined>, key: ConsultantSort) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (value) params.set(name, value);
  }
  params.set('sort', key);
  const query = params.toString();
  return query ? `/chronic/analytics?${query}` : '/chronic/analytics';
}

function rankingSortHref(searchParams: Record<string, string | undefined>, param: string, sort: RankingSort) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (value) params.set(name, value);
  }
  params.set(param, sort);
  const query = params.toString();
  return query ? `/chronic/analytics?${query}` : '/chronic/analytics';
}

function sortedRankingRows(rows: { label: string; value: number }[], sort: RankingSort, direction: 'top' | 'bottom') {
  const valueSorted = rows
    .slice()
    .sort((a, b) => direction === 'top'
      ? b.value - a.value || a.label.localeCompare(b.label)
      : a.value - b.value || a.label.localeCompare(b.label))
    .slice(0, 10);
  if (sort === 'label') return valueSorted.sort((a, b) => a.label.localeCompare(b.label));
  return valueSorted;
}

function ExecutiveRankingSection({
  title,
  rows,
  color,
  sort,
  sortParam,
  searchParams,
}: {
  title: string;
  rows: { label: string; value: number }[];
  color: string;
  sort: RankingSort;
  sortParam: string;
  searchParams: Record<string, string | undefined>;
}) {
  const topRows = sortedRankingRows(rows, sort, 'top');
  const bottomRows = sortedRankingRows(rows, sort, 'bottom');
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <p className="section-title" style={{ margin: 0 }}>{title}</p>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>Sort</span>
          {(['value', 'label'] as const).map((mode) => (
            <Link
              key={mode}
              href={rankingSortHref(searchParams, sortParam, mode)}
              style={{
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0 10px',
                color: sort === mode ? 'var(--accent-ink)' : 'var(--text-muted)',
                background: sort === mode ? 'var(--accent-soft)' : 'var(--surface)',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 850,
              }}
            >
              {mode === 'value' ? 'Value' : 'Label'}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <ChartCard title={`${title} - Top 10`} rows={topRows} color={color} />
        <ChartCard title={`${title} - Bottom 10`} rows={bottomRows} color={color} />
      </div>
    </section>
  );
}

function ConsultantTable({ data, sort, searchParams }: {
  data: Awaited<ReturnType<typeof getChronicOverview>>['analytics']['consultants'];
  sort: ConsultantSort;
  searchParams: Record<string, string | undefined>;
}) {
  const rows = data.slice().sort((a, b) => {
    const value = b[sort] - a[sort];
    return value || a.label.localeCompare(b.label);
  });

  return (
    <section className="card">
      <p className="section-title">Consultant Ranking</p>
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>Consultant</th>
                {CONSULTANT_HEADERS.map((header) => (
                  <th key={header.key} style={{ textAlign: 'right', padding: '10px 8px', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>
                    <Link href={sortHref(searchParams, header.key)} style={{ color: sort === header.key ? 'var(--accent-ink)' : 'var(--text-soft)', textDecoration: 'none', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 800 }}>
                      {header.label}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.label}</td>
                  <td style={cellStyle}>{row.patients.toLocaleString()}</td>
                  <td style={cellStyle}>{row.recommendations.toLocaleString()}</td>
                  <td style={cellStyle}>{row.issues.toLocaleString()}</td>
                  <td style={cellStyle}>{row.recommendationPct.toFixed(1)}%</td>
                  <td style={cellStyle}>{row.issuePct.toFixed(1)}%</td>
                  <td style={cellStyle}>{row.avgMedications.toFixed(2)}</td>
                  <td style={cellStyle}>{row.improvementPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="chart-empty">No consultant data for the selected filters</div>}
    </section>
  );
}

const cellStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '11px 8px',
  borderBottom: '1px solid var(--border-soft)',
  fontVariantNumeric: 'tabular-nums',
};

function MedicationTable({ rows }: { rows: ChronicMedicationAnalytics[] }) {
  return (
    <section className="card">
      <p className="section-title">Medication Intelligence</p>
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Medication', 'Top Medications', 'Issue Rate', 'Recommendation Rate', 'Most Frequent Issues', 'Most Frequent Recommendations'].map((header, index) => (
                  <th key={header} style={{ textAlign: index < 2 ? 'left' : 'right', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.label}</td>
                  <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontVariantNumeric: 'tabular-nums' }}>{row.medications.toLocaleString()}</td>
                  <td style={cellStyle}>{row.issueRate.toFixed(1)}%</td>
                  <td style={cellStyle}>{row.recommendationRate.toFixed(1)}%</td>
                  <td style={cellStyle}>{row.topIssues.join(', ') || 'None'}</td>
                  <td style={cellStyle}>{row.topRecommendations.join(', ') || 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="chart-empty">No medication data for the selected filters</div>}
    </section>
  );
}

function ExecutiveInsights({ insights }: { insights: string[] }) {
  return (
    <section className="card">
      <p className="section-title">Executive Insights</p>
      {insights.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {insights.map((insight, index) => (
            <div key={insight} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', padding: '12px 14px', boxShadow: 'var(--shadow-xs)' }}>
              <span aria-hidden style={{ color: index === 0 ? 'var(--accent)' : 'var(--text-soft)', fontWeight: 900 }}>{index + 1}</span>
              <span className="muted" style={{ fontWeight: 700 }}>{insight}</span>
            </div>
          ))}
        </div>
      ) : <div className="chart-empty">No deterministic insights for the selected filters</div>}
    </section>
  );
}

export default async function ChronicAnalyticsPage({ searchParams }: {
  searchParams: {
    period?: string;
    consultant?: string;
    recommendation?: string;
    issue?: string;
    medication?: string;
    patient?: string;
    sort?: string;
    issueRankSort?: string;
    recommendationRankSort?: string;
    consultantRankSort?: string;
    medicationRankSort?: string;
  };
}) {
  const data = await getChronicOverview(searchParams);
  const periodSuffix = data.currentPeriod ? ` - ${data.currentPeriod}` : '';
  const consultantSort = (CONSULTANT_HEADERS.some((header) => header.key === searchParams.sort) ? searchParams.sort : 'patients') as ConsultantSort;
  const issueRankSort = (searchParams.issueRankSort === 'label' ? 'label' : 'value') as RankingSort;
  const recommendationRankSort = (searchParams.recommendationRankSort === 'label' ? 'label' : 'value') as RankingSort;
  const consultantRankSort = (searchParams.consultantRankSort === 'label' ? 'label' : 'value') as RankingSort;
  const medicationRankSort = (searchParams.medicationRankSort === 'label' ? 'label' : 'value') as RankingSort;
  const topIssues = rankedRows(data.topIssues, 10);
  const topRecommendations = rankedRows(data.topRecommendations, 10);
  const issueRankingRows = data.prePost.issueCatalog.map((row) => ({ label: row.label, value: row.post }));
  const recommendationRankingRows = data.prePost.recommendationCatalog.map((row) => ({ label: row.label, value: row.post }));
  const consultantRankingRows = data.analytics.consultants.map((row) => ({ label: row.label, value: row.patients }));
  const medicationRankingRows = data.analytics.medications.map((row) => ({ label: row.label, value: row.medications }));

  return (
    <section style={{ display: 'grid', gap: 22 }}>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Chronic Intelligence Center</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Executive analytics for issue and recommendation intelligence{periodSuffix}.
          </p>
        </div>
        <Link
          href="/chronic"
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
          Overview
        </Link>
      </div>

      <form className="filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <FilterSelect name="period" label="Period" value={data.filters.period ?? ''} options={data.options.periods} />
        <FilterSelect name="consultant" label="Consultant" value={data.filters.consultant ?? ''} options={data.options.consultants} />
        <FilterSelect name="recommendation" label="Recommendation" value={data.filters.recommendation ?? ''} options={data.options.recommendations} />
        <FilterSelect name="issue" label="Issue" value={data.filters.issue ?? ''} options={data.options.issues} />
        <FilterSelect name="medication" label="Medication" value={data.filters.medication ?? ''} options={data.options.medications} />
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>Patient Search</span>
          <input name="patient" defaultValue={data.filters.patient ?? ''} placeholder="Patient ID" style={inputStyle} />
        </label>
        <button type="submit" style={{ height: 38, border: 0, borderRadius: 10, padding: '0 16px', background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Apply</button>
        <a href="/chronic/analytics" style={{ height: 38, display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '0 14px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700 }}>Clear</a>
      </form>

      <div className="grid kpirow">
        {data.analytics.kpis.map((metric) => <AnalyticsKpi key={metric.label} metric={metric} />)}
      </div>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Executive Ranking Analytics</p>
        <ExecutiveRankingSection title="Top Issues" rows={issueRankingRows} color="var(--danger)" sort={issueRankSort} sortParam="issueRankSort" searchParams={searchParams} />
        <ExecutiveRankingSection title="Top Recommendations" rows={recommendationRankingRows} color="var(--success)" sort={recommendationRankSort} sortParam="recommendationRankSort" searchParams={searchParams} />
        <ExecutiveRankingSection title="Top Consultants" rows={consultantRankingRows} color="var(--scans)" sort={consultantRankSort} sortParam="consultantRankSort" searchParams={searchParams} />
        <ExecutiveRankingSection title="Top Medications" rows={medicationRankingRows} color="var(--accent)" sort={medicationRankSort} sortParam="medicationRankSort" searchParams={searchParams} />
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Issue Intelligence</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <ChartCard title="Top 10 Issues" rows={topIssues} color="var(--danger)" />
          <TrendChart title="Issue Trend" points={data.trends} field="issues" color="var(--danger)" />
          <DistributionTiles title="Issue Distribution" rows={data.analytics.issuePareto} color="var(--danger)" />
          <ChartCard title="Issue Severity" rows={breakdownRows(data.analytics.issueSeverity)} color="var(--warning)" />
          <ChartCard title="Issue by Consultant" rows={breakdownRows(data.analytics.issueByConsultant)} color="var(--danger)" />
          <ChartCard title="Issue by Medication" rows={breakdownRows(data.analytics.issueByMedication)} color="var(--danger)" />
          <ChartCard title="Issue by Period" rows={breakdownRows(data.analytics.issueByPeriod)} color="var(--danger)" />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Recommendation Intelligence</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <ChartCard title="Top 10 Recommendations" rows={topRecommendations} color="var(--success)" />
          <TrendChart title="Recommendation Trend" points={data.trends} field="recommendations" color="var(--success)" />
          <DistributionTiles title="Recommendation Distribution" rows={data.topRecommendations.map((row) => ({ label: row.label, value: row.value, pct: row.pct }))} color="var(--success)" />
          <ChartCard title="Recommendation by Consultant" rows={breakdownRows(data.analytics.recommendationByConsultant)} color="var(--success)" />
          <ChartCard title="Recommendation by Medication" rows={breakdownRows(data.analytics.recommendationByMedication)} color="var(--success)" />
          <ChartCard title="Recommendation by Period" rows={breakdownRows(data.analytics.recommendationByPeriod)} color="var(--success)" />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Correlation</p>
        <CorrelationPairs pairs={data.analytics.correlations} />
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Consultant Intelligence</p>
        <ConsultantTable data={data.analytics.consultants} sort={consultantSort} searchParams={searchParams} />
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Medication Intelligence</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <ChartCard title="Top Medications" rows={data.analytics.medications.slice(0, 10).map((row) => ({ label: row.label, value: row.medications }))} color="var(--accent)" />
          <ChartCard title="Issue Rate" rows={data.analytics.medications.slice().sort((a, b) => b.issueRate - a.issueRate).map((row) => ({ label: `${row.label} - ${row.issueRate.toFixed(1)}%`, value: row.issues }))} color="var(--danger)" />
          <ChartCard title="Recommendation Rate" rows={data.analytics.medications.slice().sort((a, b) => b.recommendationRate - a.recommendationRate).map((row) => ({ label: `${row.label} - ${row.recommendationRate.toFixed(1)}%`, value: row.recommendations }))} color="var(--success)" />
        </div>
        <MedicationTable rows={data.analytics.medications.slice(0, 12)} />
      </section>

      <section style={{ display: 'grid', gap: 14 }}>
        <p className="section-title">Executive Insights</p>
        <ExecutiveInsights insights={data.analytics.insights} />
      </section>
    </section>
  );
}
