import TrendArrow from './TrendArrow';
export default function KpiCard({ label, value, delta }: { label: string; value: string | number; delta?: number }) {
  return (
    <div className="card kpi-card">
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
      </div>
      <div>{typeof delta === 'number' && <TrendArrow delta={delta} />}</div>
    </div>
  );
}
