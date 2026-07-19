'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

type ChartPoint = { label: string; value: number };

type ChartSeries = {
  label: string;
  color: string;
  values: ChartPoint[];
};

type ChartData =
  | { kind: 'line'; series: ChartSeries[] }
  | { kind: 'bar'; rows: { label: string; value: number; color?: string }[]; color: string };

type DrilldownRow = { label: string; value: number };
type DrilldownStep = { title: string; rows: DrilldownRow[] };
type DrilldownMap = Record<string, DrilldownStep[]>;

interface ExecutiveChartDrillProps {
  title: string;
  data: ChartData;
  children: ReactNode;
  drilldowns?: DrilldownMap;
}

type LineTooltip = {
  label: string;
  index: number;
  rows: { label: string; value: number; color: string }[];
};

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(name: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';
}

function formatValue(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function findStep(drilldowns: DrilldownMap | undefined, keys: string[], titles: string[]) {
  for (const key of keys) {
    const steps = drilldowns?.[key] ?? [];
    for (const title of titles) {
      const step = steps.find((item) => item.title.toLowerCase() === title.toLowerCase());
      if (step?.rows.length) return step;
    }
  }
  return null;
}

function topRows(step: DrilldownStep | null, limit = 5) {
  return (step?.rows ?? []).slice(0, limit);
}

function chartLabels(data: ChartData) {
  return data.kind === 'line'
    ? data.series[0]?.values.map((point) => point.label) ?? []
    : data.rows.map((row) => row.label);
}

function buildMonthComparison(data: ChartData, selectedLabel: string | null) {
  if (!selectedLabel || data.kind !== 'line') return [];
  const labels = chartLabels(data);
  const index = labels.indexOf(selectedLabel);
  if (index < 0) return [];
  return data.series.map((item) => {
    const current = item.values[index]?.value ?? 0;
    const previous = index > 0 ? item.values[index - 1]?.value ?? 0 : 0;
    return {
      label: item.label,
      value: current,
      meta: index > 0 ? `vs prior ${formatValue(current - previous)}` : 'first period',
    };
  });
}

function buildSelectedPeriodRows(data: ChartData, selectedLabel: string | null) {
  if (!selectedLabel) return [];
  if (data.kind === 'bar') {
    const row = data.rows.find((item) => item.label === selectedLabel);
    return row ? [{ label: 'Value', value: row.value, color: data.color }] : [];
  }
  const labels = chartLabels(data);
  const index = labels.indexOf(selectedLabel);
  if (index < 0) return [];
  return data.series.map((item) => ({
    label: item.label,
    value: item.values[index]?.value ?? 0,
    color: item.color,
  }));
}

function buildPeriodSummary(data: ChartData, selectedLabel: string | null) {
  const rows = buildSelectedPeriodRows(data, selectedLabel);
  if (data.kind !== 'line' || rows.length < 2) return [];
  const pre = rows[0]?.value ?? 0;
  const post = rows[1]?.value ?? 0;
  const difference = post - pre;
  const improvement = pre === 0 ? 0 : ((pre - post) / pre) * 100;
  return [
    { label: rows[0].label, value: pre, color: rows[0].color },
    { label: rows[1].label, value: post, color: rows[1].color },
    { label: 'Difference', value: difference, color: difference <= 0 ? 'var(--success)' : 'var(--danger)' },
    { label: 'Improvement %', value: improvement, color: improvement >= 0 ? 'var(--success)' : 'var(--danger)', suffix: '%' },
  ];
}

function LineDrillChart({
  title,
  series,
  zoom,
  pan,
  selectedLabel,
  onSelectLabel,
}: {
  title: string;
  series: ChartSeries[];
  zoom: number;
  pan: number;
  selectedLabel: string | null;
  onSelectLabel: (label: string) => void;
}) {
  const clipId = useId().replace(/:/g, '');
  const [tooltip, setTooltip] = useState<LineTooltip | null>(null);
  const width = 980;
  const height = 520;
  const left = 72;
  const right = 34;
  const top = 34;
  const bottom = 70;
  const flat = series.flatMap((item) => item.values.map((point) => point.value));
  const max = Math.max(...flat, 1);
  const min = Math.min(0, ...flat);
  const span = max - min || 1;
  const labels = series[0]?.values.map((point) => point.label) ?? [];
  const xAt = (index: number) => left + index * ((width - left - right) / Math.max(labels.length - 1, 1));
  const yAt = (value: number) => top + (1 - ((value - min) / span)) * (height - top - bottom);
  const offset = pan * 42;
  const selectedIndex = selectedLabel ? labels.indexOf(selectedLabel) : -1;

  const focusPeriod = (label: string, index: number) => {
    const rows = series.map((row) => ({
      label: row.label,
      value: row.values[index]?.value ?? 0,
      color: row.color,
    }));
    setTooltip({ label, index, rows });
    onSelectLabel(label);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg
        data-executive-chart-svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface)' }}
        onMouseLeave={() => setTooltip(null)}
      >
        <rect width={width} height={height} fill="var(--surface)" />
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + tick * ((height - top - bottom) / 4);
          const value = max - tick * (span / 4);
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border-soft)" strokeDasharray="5 5" />
              <text x={left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="var(--text-soft)" fontWeight="700">
                {value.toFixed(value < 10 ? 2 : 0)}
              </text>
            </g>
          );
        })}
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top - 8} width={width - left - right} height={height - top - bottom + 16} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g
            transform={`translate(${offset}, 0) scale(${zoom}, 1)`}
            style={{ transition: 'transform var(--motion-structural)' }}
          >
            {(tooltip || selectedIndex >= 0) ? (
              <line
                x1={xAt(tooltip?.index ?? selectedIndex)}
                x2={xAt(tooltip?.index ?? selectedIndex)}
                y1={top - 8}
                y2={height - bottom + 8}
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeDasharray="5 5"
                opacity=".55"
                pointerEvents="none"
              />
            ) : null}
            {series.map((item) => {
              const coords = item.values.map((point, index) => ({ x: xAt(index), y: yAt(point.value), point }));
              return (
                <g key={item.label}>
                  <polyline
                    points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: 'opacity var(--motion-hover)' }}
                  />
                  {coords.map(({ x, y, point }, index) => (
                    <circle
                      key={`${item.label}-${point.label}`}
                      cx={x}
                      cy={y}
                      r={selectedLabel === point.label ? 7 : 5}
                      fill={item.color}
                      stroke="var(--surface)"
                      strokeWidth="2"
                      style={{ transition: 'r var(--motion-hover)' }}
                      onMouseMove={() => focusPeriod(point.label, index)}
                      onFocus={() => focusPeriod(point.label, index)}
                      onClick={() => onSelectLabel(point.label)}
                    />
                  ))}
                </g>
              );
            })}
            {labels.map((label, index) => (
              <rect
                key={`hit-${label}`}
                x={xAt(index) - 18}
                y={top - 8}
                width="36"
                height={height - top - bottom + 16}
                fill="transparent"
                cursor="crosshair"
                onMouseMove={() => focusPeriod(label, index)}
                onClick={() => onSelectLabel(label)}
              />
            ))}
          </g>
        </g>
        {labels.map((label, index) => index % Math.ceil(labels.length / 7 || 1) === 0 ? (
          <text key={label} x={xAt(index)} y={height - 28} textAnchor="middle" fontSize="12" fill="var(--text-soft)" fontWeight="800">
            {label}
          </text>
        ) : null)}
      </svg>
      {tooltip ? <span className="sr-only">{tooltip.label} selected for drilldown</span> : null}
    </div>
  );
}

function BarDrillChart({
  title,
  rows,
  color,
  zoom,
  pan,
  selectedLabel,
  onSelectLabel,
}: {
  title: string;
  rows: { label: string; value: number; color?: string }[];
  color: string;
  zoom: number;
  pan: number;
  selectedLabel: string | null;
  onSelectLabel: (label: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const width = 980;
  const rowHeight = 42;
  const height = Math.max(360, 78 + rows.length * rowHeight);
  const left = 230;
  const right = 44;
  const top = 30;
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div style={{ position: 'relative', maxHeight: '62vh', overflow: 'auto' }}>
      <svg
        data-executive-chart-svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface)' }}
        onMouseLeave={() => setTooltip(null)}
      >
        <rect width={width} height={height} fill="var(--surface)" />
        <g transform={`translate(${pan * 42}, 0) scale(${zoom}, 1)`} style={{ transition: 'transform var(--motion-structural)' }}>
          {rows.map((row, index) => {
            const y = top + index * rowHeight;
            const w = ((width - left - right) * row.value) / max;
            const active = selectedLabel === row.label;
            return (
              <g key={row.label}>
                <text x={left - 14} y={y + 23} textAnchor="end" fontSize="12" fill="var(--text)" fontWeight="800">{row.label}</text>
                <rect x={left} y={y + 6} width={width - left - right} height="20" rx="6" fill="var(--surface-3)" />
                <rect
                  x={left}
                  y={y + 6}
                  width={Math.max(w, 2)}
                  height="20"
                  rx="6"
                  fill={row.color ?? color}
                  opacity={active ? 1 : .9}
                  cursor="pointer"
                  onMouseMove={(event) => setTooltip({ x: event.clientX, y: event.clientY, label: row.label, value: row.value })}
                  onMouseEnter={() => onSelectLabel(row.label)}
                  onClick={() => onSelectLabel(row.label)}
                />
                <text x={left + w + 10} y={y + 22} fontSize="12" fill="var(--text-muted)" fontWeight="800">{formatValue(row.value, 0)}</text>
              </g>
            );
          })}
        </g>
      </svg>
      {tooltip ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(tooltip.x + 14, window.innerWidth - 240),
            top: Math.min(tooltip.y + 14, window.innerHeight - 110),
            zIndex: 70,
            width: 220,
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-md)',
            padding: 10,
            pointerEvents: 'none',
          }}
        >
          <b style={{ display: 'block', marginBottom: 8 }}>{tooltip.label}</b>
          <span className="rank-value">{formatValue(tooltip.value, 0)}</span>
        </div>
      ) : null}
    </div>
  );
}

function DrilldownMiniList({ title, rows }: { title: string; rows: Array<DrilldownRow & { meta?: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="chronic-drill-panel-card">
      <div className="chronic-drill-panel-title">{title}</div>
      {rows.length ? (
        <div className="chronic-drill-mini-list">
          {rows.map((row) => (
            <div key={`${title}-${row.label}`} className="chronic-drill-mini-row">
              <div className="chronic-drill-mini-meta">
                <span>{row.label}</span>
                <b>{formatValue(row.value)}</b>
              </div>
              <div className="rank-track" aria-hidden="true">
                <div className="rank-fill" style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, background: 'linear-gradient(90deg, var(--accent), var(--labs))' }} />
              </div>
              {row.meta ? <span className="muted" style={{ fontSize: 11 }}>{row.meta}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="table-empty" style={{ minHeight: 120 }}>No drilldown rows for this filtered scope</div>
      )}
    </div>
  );
}

function SelectedPeriodCard({ chartTitle, selectedLabel, rows }: {
  chartTitle: string;
  selectedLabel: string | null;
  rows: ReturnType<typeof buildPeriodSummary>;
}) {
  return (
    <div className="chronic-drill-period-card">
      <div>
        <div className="chronic-drill-panel-title">{chartTitle}</div>
        <p className="muted" style={{ margin: '4px 0 0' }}>{selectedLabel ?? 'Select a period'}</p>
      </div>
      {rows.length ? (
        <div className="chronic-drill-period-grid">
          {rows.map((row) => (
            <div key={row.label} className="chronic-drill-period-metric" style={{ borderColor: row.color }}>
              <span>{row.label}</span>
              <b style={{ color: row.color }}>{formatValue(row.value)}{row.suffix ?? ''}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-empty" style={{ minHeight: 120 }}>Hover a month to show chart values</div>
      )}
    </div>
  );
}

function AnalyticsDrilldownPanel({
  chartTitle,
  data,
  drilldowns,
  selectedLabel,
}: {
  chartTitle: string;
  data: ChartData;
  drilldowns?: DrilldownMap;
  selectedLabel: string | null;
}) {
  const isIssueChart = chartTitle.toLowerCase().includes('issue');
  const primaryKeys = isIssueChart ? ['Issues', 'Total Issues'] : ['Recommendations', 'Total Recommendations'];
  const categoryTitle = isIssueChart ? 'Top Issues' : 'Top Recommendations';
  const categoryLookup = isIssueChart ? ['Top Categories', 'Top Issues'] : ['Top Categories', 'Top Recommendations'];
  const periodRows = buildPeriodSummary(data, selectedLabel);
  const blocks = [
    { title: 'Month Comparison', rows: buildMonthComparison(data, selectedLabel) },
    { title: categoryTitle, rows: topRows(findStep(drilldowns, primaryKeys, categoryLookup)) },
    { title: 'Top Consultants', rows: topRows(findStep(drilldowns, primaryKeys, ['Top Consultants'])) },
    { title: 'Top Medications', rows: topRows(findStep(drilldowns, primaryKeys, ['Top Medications'])) },
    { title: 'Top Patients', rows: topRows(findStep(drilldowns, [...primaryKeys, 'Patients'], ['Top Patients'])) },
    { title: 'Weekly Breakdown', rows: topRows(findStep(drilldowns, primaryKeys, ['Top Weeks', 'Weekly Trend'])) },
  ];

  return (
    <section className="chronic-drill-panel" aria-label="Chart drill down analytics">
      <div className="chronic-drill-panel-head">
        <div>
          <p className="section-title">Drill Down</p>
          <p className="muted" style={{ margin: 0 }}>
            {selectedLabel ? `${selectedLabel} values update as you hover the chart.` : 'Hover a month to show detailed analytics.'}
          </p>
        </div>
      </div>
      <SelectedPeriodCard chartTitle={chartTitle} selectedLabel={selectedLabel} rows={periodRows} />
      <div className="chronic-drill-panel-grid">
        {blocks.map((block) => <DrilldownMiniList key={block.title} title={block.title} rows={block.rows} />)}
      </div>
    </section>
  );
}

export default function ExecutiveChartDrill({ title, data, children, drilldowns }: ExecutiveChartDrillProps) {
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const labels = useMemo(() => chartLabels(data), [data]);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setPan(0);
    setSelectedLabel(labels[labels.length - 1] ?? null);
  }, [open, labels]);

  const csv = useMemo(() => {
    const base = data.kind === 'line'
      ? [
          ['Period', ...data.series.map((item) => item.label)].map(csvEscape).join(','),
          ...(data.series[0]?.values.map((point, index) => [
            point.label,
            ...data.series.map((item) => item.values[index]?.value ?? ''),
          ].map(csvEscape).join(',')) ?? []),
        ]
      : [
          ['Label', 'Value'].join(','),
          ...data.rows.map((row) => [row.label, row.value].map(csvEscape).join(',')),
        ];

    if (!selectedLabel) return base.join('\n');

    const panelRows = [
      [''],
      ['Selected Drill Down', selectedLabel].map(csvEscape).join(','),
      ...[
        { title: 'Top Issues', rows: topRows(findStep(drilldowns, ['Issues', 'Total Issues'], ['Top Categories', 'Top Issues']), 10) },
        { title: 'Top Recommendations', rows: topRows(findStep(drilldowns, ['Recommendations', 'Total Recommendations'], ['Top Categories', 'Top Recommendations']), 10) },
        { title: 'Top Consultants', rows: topRows(findStep(drilldowns, ['Issues', 'Recommendations'], ['Top Consultants']), 10) },
        { title: 'Top Medications', rows: topRows(findStep(drilldowns, ['Issues', 'Recommendations'], ['Top Medications']), 10) },
        { title: 'Top Patients', rows: topRows(findStep(drilldowns, ['Issues', 'Recommendations', 'Patients'], ['Top Patients']), 10) },
        { title: 'Weekly Breakdown', rows: topRows(findStep(drilldowns, ['Issues', 'Recommendations'], ['Top Weeks', 'Weekly Trend']), 10) },
      ].flatMap((block) => [
        [''],
        [block.title].map(csvEscape).join(','),
        ['Label', 'Value'].join(','),
        ...block.rows.map((row) => [row.label, row.value].map(csvEscape).join(',')),
      ]),
    ];
    return [...base, ...panelRows].join('\n');
  }, [data, drilldowns, selectedLabel]);

  async function downloadPng() {
    const svg = document.querySelector<SVGSVGElement>('[data-executive-chart-svg]');
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1200, image.width || 1200);
      canvas.height = Math.max(700, image.height || 700);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) return;
        const pngUrl = URL.createObjectURL(png);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `${slug(title)}.png`;
        link.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    image.src = url;
  }

  const hasData = data.kind === 'line'
    ? data.series.some((item) => item.values.length)
    : data.rows.length > 0;
  const zoomIn = () => setZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))));
  const zoomOut = () => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))));
  const resetView = () => { setZoom(1); setPan(0); };

  return (
    <>
      <div
        role="button"
        tabIndex={hasData ? 0 : -1}
        onClick={() => hasData && setOpen(true)}
        onKeyDown={(event) => {
          if (!hasData) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={`Open ${title} executive drill view`}
        aria-keyshortcuts="Enter Space"
        aria-disabled={!hasData}
        data-chart-trigger
        style={{
          display: 'block',
          width: '100%',
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          textAlign: 'inherit',
          cursor: hasData ? 'zoom-in' : 'default',
        }}
      >
        {children}
      </div>
      {open ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(15, 23, 42, .45)',
            padding: 18,
          }}
        >
          <section
            className="chronic-modal chronic-dialog-enter"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
            onKeyDown={(event) => {
              if (event.key === '+') {
                event.preventDefault();
                zoomIn();
              }
              if (event.key === '-') {
                event.preventDefault();
                zoomOut();
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setPan((value) => value - 1);
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                setPan((value) => value + 1);
              }
              if (event.key.toLowerCase() === 'r') {
                event.preventDefault();
                resetView();
              }
            }}
            style={{
              maxWidth: 1520,
              maxHeight: '92vh',
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'auto auto minmax(0, 1fr)',
              gap: 14,
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-lg)',
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <h2 id={dialogId} style={{ margin: 0, fontSize: 20, letterSpacing: 0 }}>{title}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>Executive interactive analytics</p>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} style={{ height: 34, minWidth: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontWeight: 900, cursor: 'pointer' }} aria-label="Close chart drill view">X</button>
            </div>
            <div className="chronic-modal-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" onClick={zoomIn} style={toolbarButton}>Zoom +</button>
                <button type="button" onClick={zoomOut} style={toolbarButton}>Zoom -</button>
                <button type="button" onClick={() => setPan((value) => value - 1)} style={toolbarButton}>Pan Left</button>
                <button type="button" onClick={() => setPan((value) => value + 1)} style={toolbarButton}>Pan Right</button>
                <button type="button" onClick={resetView} style={toolbarButton}>Reset Zoom</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" onClick={downloadPng} style={toolbarButton}>Download PNG</button>
                <button type="button" onClick={() => downloadBlob(`${slug(title)}.csv`, 'text/csv;charset=utf-8', csv)} style={toolbarButton}>Download CSV</button>
              </div>
            </div>
            <div className="chronic-chart-drill-scroll">
              <div className="chronic-chart-drill-surface">
                {data.kind === 'line'
                  ? <LineDrillChart title={title} series={data.series} zoom={zoom} pan={pan} selectedLabel={selectedLabel} onSelectLabel={setSelectedLabel} />
                  : <BarDrillChart title={title} rows={data.rows} color={data.color} zoom={zoom} pan={pan} selectedLabel={selectedLabel} onSelectLabel={setSelectedLabel} />}
                <div className="trend-legend" style={{ marginTop: 12 }}>
                  {data.kind === 'line'
                    ? data.series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)
                    : <span><i style={{ background: data.color }} />Value</span>}
                </div>
              </div>
              <AnalyticsDrilldownPanel chartTitle={title} data={data} drilldowns={drilldowns} selectedLabel={selectedLabel} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

const toolbarButton: CSSProperties = {
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  padding: '0 10px',
  fontWeight: 800,
  cursor: 'pointer',
};
