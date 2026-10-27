'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Utilisation and yield over the selected range.
 *
 * Two series on ONE axis: both are percentages of the same rostered minutes, so
 * they share a scale by construction. The gap between the lines is the reading
 * - capacity that was booked but never became a completed consultation.
 */

export interface TrendPoint {
  date: string;
  utilisation: number | null;
  yield: number | null;
}

const W = 960;
const H = 260;
const PAD = { top: 16, right: 56, bottom: 28, left: 44 };

const SERIES = [
  { key: 'utilisation' as const, label: 'Utilisation', color: 'var(--cap-util)' },
  { key: 'yield' as const, label: 'Yield', color: 'var(--cap-yield)' },
];

const shortDate = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;

export default function CapacityTrend({ points }: { points: TrendPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const usable = useMemo(() => points.filter((point) => point.utilisation != null), [points]);

  const max = useMemo(() => {
    const highest = Math.max(100, ...usable.map((point) => point.utilisation ?? 0));
    // Round up to a clean 25 so the gridlines land on readable numbers.
    return Math.ceil(highest / 25) * 25;
  }, [usable]);

  const x = useCallback(
    (index: number) =>
      PAD.left + (usable.length < 2 ? 0 : (index / (usable.length - 1)) * (W - PAD.left - PAD.right)),
    [usable.length],
  );
  const y = useCallback((value: number) => PAD.top + (1 - value / max) * (H - PAD.top - PAD.bottom), [max]);

  const onMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (!box || usable.length < 2) return;
      const ratio = (event.clientX - box.left) / box.width;
      const svgX = ratio * W;
      const step = (W - PAD.left - PAD.right) / (usable.length - 1);
      const index = Math.round((svgX - PAD.left) / step);
      setHover(index >= 0 && index < usable.length ? index : null);
    },
    [usable.length],
  );

  if (usable.length < 2) {
    return <p className="muted" style={{ margin: 0 }}>Not enough days in this range to draw a trend.</p>;
  }

  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];

  // When the two series finish on the same value - which happens on any day the
  // export has no bookings for - their end labels land on the same pixel and
  // read as one. Push them apart so both stay legible; the dots keep sitting on
  // the true values, so only the text moves.
  const endLabelY = (() => {
    const raw = SERIES.map((series) => y(usable[usable.length - 1][series.key] ?? 0) + 4);
    const MIN_GAP = 13;
    if (Math.abs(raw[0] - raw[1]) >= MIN_GAP) return raw;

    // Each label is derived from the other rather than clamped independently:
    // clamping both lets a bound swallow the separation and stack them again,
    // which happens at the bottom when a day has no bookings and at the top
    // when a day runs well over capacity.
    const [high, low] = raw[0] <= raw[1] ? [0, 1] : [1, 0];
    const mid = (raw[0] + raw[1]) / 2;
    const top = PAD.top + 8;
    const bottom = H - PAD.bottom;

    let highY = Math.max(top, Math.min(bottom - MIN_GAP, mid - MIN_GAP / 2));
    let lowY = Math.min(bottom, highY + MIN_GAP);
    highY = Math.max(top, lowY - MIN_GAP);

    const adjusted = [...raw];
    adjusted[high] = highY;
    adjusted[low] = lowY;
    return adjusted;
  })();
  // Enough x labels to orient, never so many that they collide.
  const labelEvery = Math.max(1, Math.ceil(usable.length / 10));
  const active = hover == null ? null : usable[hover];

  return (
    <>
      <ul className="cap-legend">
        {SERIES.map((series) => (
          <li key={series.key}>
            <span className="cap-swatch" style={{ background: series.color }} />
            {series.label}
          </li>
        ))}
      </ul>

      <div
        className="cap-chart-wrap"
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Utilisation and yield by day">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--cap-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--text-soft)">
                {tick}%
              </text>
            </g>
          ))}

          {/* Full capacity. Above this line the day was over-booked. */}
          {max > 100 && (
            <g>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(100)}
                y2={y(100)}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <text x={W - PAD.right + 6} y={y(100) + 4} fontSize={11} fill="var(--text-soft)">
                full
              </text>
            </g>
          )}

          {usable.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.date}
                x={x(index)}
                y={H - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-soft)"
              >
                {shortDate(point.date)}
              </text>
            ) : null,
          )}

          {SERIES.map((series, order) => {
            const path = usable
              .map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point[series.key] ?? 0)}`)
              .join(' ');
            const last = usable[usable.length - 1][series.key] ?? 0;
            return (
              <g key={series.key}>
                <path d={path} fill="none" stroke={series.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {/* Direct label at the line end: identity without reading the legend. */}
                <circle cx={x(usable.length - 1)} cy={y(last)} r={4} fill={series.color} stroke="var(--surface)" strokeWidth={2} />
                <text x={W - PAD.right + 6} y={endLabelY[order]} fontSize={11} fill={series.color} fontWeight={600}>
                  {last.toFixed(0)}%
                </text>
              </g>
            );
          })}

          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--border-strong)" strokeWidth={1} />
              {SERIES.map((series) => (
                <circle
                  key={series.key}
                  cx={x(hover)}
                  cy={y(usable[hover][series.key] ?? 0)}
                  r={4}
                  fill={series.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>

        {active && (
          <div
            className="cap-tooltip"
            style={{
              left: `calc(${(x(hover!) / W) * 100}% + ${x(hover!) / W > 0.6 ? '-150px' : '14px'})`,
              top: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{active.date}</div>
            {SERIES.map((series) => (
              <div className="cap-tooltip-row" key={series.key}>
                <span className="cap-swatch" style={{ background: series.color }} />
                {series.label}
                <span className="cap-tooltip-num">{(active[series.key] ?? 0).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
