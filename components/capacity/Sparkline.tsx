/**
 * A stat tile's trend: the shape of the period, not a readable chart.
 *
 * Drawn in the de-emphasis hue with only the final point in the series color,
 * so the tile's number stays the thing being read. No axes, no labels, no
 * tooltip - everything it could say is already in the tile.
 */
export default function Sparkline({
  values,
  color = 'var(--cap-util)',
  width = 108,
  height = 30,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) return <div style={{ height }} aria-hidden />;

  // A flat series would divide by zero; draw it down the middle instead.
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (points.length - 1);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);

  const path = points.map((value, index) => `${index ? 'L' : 'M'}${pad + index * stepX},${y(value)}`).join(' ');
  const lastX = pad + (points.length - 1) * stepX;
  const lastY = y(points[points.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden>
      <path d={path} fill="none" stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* 2px surface ring keeps the end dot legible wherever the line ends. */}
      <circle cx={lastX} cy={lastY} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
