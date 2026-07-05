import type { TrendPoint, TrendResponse } from '@/lib/types';

const LABEL: Record<string, string> = {
  '2026-01': 'Jan',
  '2026-02': 'Feb',
  '2026-03': 'Mar',
  '2026-04': 'Apr',
  '2026-05': 'May',
  '2026-06': 'Jun',
};

const SERIES = [
  { key: 'meds', label: 'Meds / visit', color: '#635bff' },
  { key: 'labs', label: 'Labs / visit', color: '#16a36f' },
  { key: 'scans', label: 'Scans / visit', color: '#2563eb' },
] as const;

const MONTH_LABEL: Record<string, string> = {
  '2026-01': 'Jan 2026',
  '2026-02': 'Feb 2026',
  '2026-03': 'Mar 2026',
  '2026-04': 'Apr 2026',
  '2026-05': 'May 2026',
  '2026-06': 'Jun 2026',
};

function formatPoints(points: TrendPoint[], key: typeof SERIES[number]['key'], min: number, max: number) {
  const width = 760;
  const height = 260;
  const left = 44;
  const right = 18;
  const top = 18;
  const bottom = 34;
  const xStep = points.length > 1 ? (width - left - right) / (points.length - 1) : 0;
  const span = max - min || 1;

  return points.map((point, index) => {
    const x = left + index * xStep;
    const y = top + (1 - ((point[key] - min) / span)) * (height - top - bottom);
    return `${x},${y}`;
  }).join(' ');
}

function formatDelta(value: number) {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function tooltipText(point: TrendPoint, delta?: TrendResponse['delta']) {
  const lines = [
    `Month: ${MONTH_LABEL[point.month] ?? point.month}`,
    `Visits: ${typeof point.visits === 'number' ? point.visits.toLocaleString() : 'N/A'}`,
    `Avg Meds / Visit: ${point.meds.toFixed(2)}`,
    `Avg Labs / Visit: ${point.labs.toFixed(2)}`,
    `Avg Scans / Visit: ${point.scans.toFixed(2)}`,
  ];
  if (delta) {
    lines.push(`MoM Delta - Meds: ${formatDelta(delta.meds)}`);
    lines.push(`MoM Delta - Labs: ${formatDelta(delta.labs)}`);
    lines.push(`MoM Delta - Scans: ${formatDelta(delta.scans)}`);
  }
  return lines.join('\n');
}

export default function TrendLine({ points, delta }: { points: TrendPoint[]; delta?: TrendResponse['delta'] }) {
  if (!points.length) {
    return <div className="chart-empty">No trend data for the selected filters</div>;
  }

  const values = points.flatMap((point) => SERIES.map((series) => point[series.key]));
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) / 4) * (4 - i));
  const baseline = 226;

  return (
    <div className="trend-chart">
      <svg viewBox="0 0 760 300" role="img" aria-label="Average per visit by month">
        <defs>
          {SERIES.map((series) => (
            <linearGradient key={series.key} id={`trend-fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={series.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {SERIES.map((series) => {
          const line = formatPoints(points, series.key, min, max);
          const first = line.split(' ')[0].split(',');
          const last = line.split(' ').slice(-1)[0].split(',');
          return (
            <polygon
              key={`area-${series.key}`}
              points={`${first[0]},${baseline} ${line} ${last[0]},${baseline}`}
              fill={`url(#trend-fill-${series.key})`}
            />
          );
        })}
        {ticks.map((tick, index) => {
          const y = 18 + index * 52;
          return (
            <g key={tick}>
              <line className="trend-grid" x1="44" x2="742" y1={y} y2={y} />
              <text className="trend-axis" x="0" y={y + 4}>{tick.toFixed(1)}</text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = 44 + index * ((760 - 44 - 18) / Math.max(points.length - 1, 1));
          return (
            <text className="trend-axis" key={point.month} x={x} y="286" textAnchor="middle">
              {LABEL[point.month] ?? point.month}
            </text>
          );
        })}
        {SERIES.map((series) => (
          <polyline
            key={series.key}
            className="trend-line"
            points={formatPoints(points, series.key, min, max)}
            stroke={series.color}
          />
        ))}
        {SERIES.map((series) => points.map((point, index) => {
          const [x, y] = formatPoints([point], series.key, min, max).split(',').map(Number);
          const adjustedX = 44 + index * ((760 - 44 - 18) / Math.max(points.length - 1, 1));
          const pointDelta = index === points.length - 1 ? delta : undefined;
          return (
            <g key={`${series.key}-${point.month}`}>
              <title>{tooltipText(point, pointDelta)}</title>
              <circle cx={adjustedX || x} cy={y} r="10" fill="transparent" pointerEvents="all" />
              <circle className="trend-dot" cx={adjustedX || x} cy={y} r="3.5" fill={series.color} />
            </g>
          );
        }))}
      </svg>
      <div className="trend-legend">
        {SERIES.map((series) => (
          <span key={series.key}><i style={{ background: series.color }} />{series.label}</span>
        ))}
      </div>
    </div>
  );
}
