import Sparkline from './Sparkline';

/**
 * Stat tile: label, value, an optional one-line reading, and the shape of the
 * period. A single current number is a tile, never a one-bar chart.
 */
export default function StatTile({
  label,
  value,
  foot,
  trend,
  color,
}: {
  label: string;
  value: string;
  foot?: string;
  trend?: number[];
  color?: string;
}) {
  return (
    <div className="card cap-tile">
      <span className="cap-tile-label">{label}</span>
      <span className="cap-tile-value">{value}</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <span className="cap-tile-foot">{foot}</span>
        {trend && trend.length > 1 && <Sparkline values={trend} color={color} />}
      </div>
    </div>
  );
}
