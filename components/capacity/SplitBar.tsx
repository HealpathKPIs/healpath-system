'use client';

/**
 * Where the rostered hours went, as one bar of 100%.
 *
 * Part-to-whole, so a stacked bar rather than a ring: the segments share a
 * common baseline and can be compared against each other and against the whole.
 * The four parts are measured against the same rostered minutes every other
 * number on this page uses, so they sum to exactly 100% by construction.
 */

export interface SplitSegment {
  key: string;
  label: string;
  minutes: number;
  color: string;
}

const hours = (minutes: number) => (minutes / 60).toFixed(0);

export default function SplitBar({ segments, totalMinutes }: { segments: SplitSegment[]; totalMinutes: number }) {
  if (totalMinutes <= 0) {
    return <p className="muted" style={{ margin: 0 }}>No rostered time in this range.</p>;
  }

  const visible = segments.filter((segment) => segment.minutes > 0);
  const share = (minutes: number) => (minutes / totalMinutes) * 100;

  return (
    <>
      <div
        style={{
          display: 'flex',
          // The 2px surface gap is what separates touching segments. No strokes:
          // a border around a mark adds ink that is not data.
          gap: 2,
          height: 28,
          marginBottom: 14,
        }}
        role="img"
        aria-label={visible
          .map((segment) => `${segment.label} ${share(segment.minutes).toFixed(1)} percent`)
          .join(', ')}
      >
        {visible.map((segment, index) => (
          <div
            key={segment.key}
            title={`${segment.label} · ${hours(segment.minutes)} h · ${share(segment.minutes).toFixed(1)}%`}
            style={{
              width: `${share(segment.minutes)}%`,
              background: segment.color,
              // Square where it meets its neighbours, rounded at the two ends
              // of the whole bar.
              borderRadius:
                visible.length === 1
                  ? 4
                  : index === 0
                    ? '4px 0 0 4px'
                    : index === visible.length - 1
                      ? '0 4px 4px 0'
                      : 0,
            }}
          />
        ))}
      </div>

      <ul className="cap-legend" style={{ flexDirection: 'column', gap: 8 }}>
        {segments.map((segment) => (
          <li key={segment.key} style={{ width: '100%' }}>
            <span className="cap-swatch" style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <span className="cap-tooltip-num" style={{ color: 'var(--text)' }}>
              {hours(segment.minutes)} h
            </span>
            <span style={{ width: 54, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {share(segment.minutes).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
