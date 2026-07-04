export default function TrendArrow({ delta }: { delta: number }) {
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sym = delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  const sign = delta > 0 ? '+' : '';

  return (
    <span className={`kpi-delta ${cls}`}>
      <span className="trend-symbol">{sym}</span>
      {sign}
      {delta.toFixed(2)} vs prev month
    </span>
  );
}
