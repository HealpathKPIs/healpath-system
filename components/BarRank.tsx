import type { RankRow } from '@/lib/types';

export default function BarRank({ data, color = '#635bff' }: { data: RankRow[]; color?: string; height?: number }) {
  if (!data.length) {
    return <div className="chart-empty">No data for the selected filters</div>;
  }

  const max = Math.max(...data.map((row) => row.value), 1);

  return (
    <div className="rank-list">
      {data.map((row) => {
        const width = `${Math.max(4, (row.value / max) * 100)}%`;

        return (
          <div className="rank-row" key={row.label}>
            <div className="rank-meta">
              <span className="rank-label" title={row.label}>{row.label}</span>
              <span className="rank-value">{row.value.toLocaleString()}</span>
            </div>
            <div className="rank-track">
              <div className="rank-fill" style={{ width, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
