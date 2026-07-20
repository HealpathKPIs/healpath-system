import PageHead from '@/components/PageHead';
import TrendLine from '@/components/TrendLine';
import TrendArrow from '@/components/TrendArrow';
import { getTrends, resolveFilters } from '@/lib/queries';

export default async function Trends({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string; riskCarrier?: string; sel?: string; selv?: string } }) {
  const f = resolveFilters(searchParams, { doctor: true, drug: true, disease: true });
  const trends = await getTrends(f.specialty, f.doctor, f.drug, f.disease, f.riskCarrier);
  return (
    <>
      <PageHead title="Trends" months={trends.points.map((point) => point.month)} />
      <div className="card" style={{ marginBottom: 18 }}>
        <p className="section-title">Average per visit by month</p>
        <TrendLine points={trends.points} delta={trends.delta} />
      </div>
      <div className="card">
        <p className="section-title">Delta vs previous month</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
          <div><div className="kpi-label">Meds</div><TrendArrow delta={trends.delta.meds} /></div>
          <div><div className="kpi-label">Labs</div><TrendArrow delta={trends.delta.labs} /></div>
          <div><div className="kpi-label">Scans</div><TrendArrow delta={trends.delta.scans} /></div>
        </div>
      </div>
    </>
  );
}
