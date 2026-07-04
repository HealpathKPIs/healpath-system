import PageHead from '@/components/PageHead';
import TrendLine from '@/components/TrendLine';
import TrendArrow from '@/components/TrendArrow';
import { getTrends } from '@/lib/queries';

export default async function Trends({ searchParams }: { searchParams: { specialty?: string } }) {
  const trends = await getTrends(searchParams.specialty ?? null);
  return (
    <>
      <PageHead title="Trends" />
      <div className="card" style={{ marginBottom: 18 }}>
        <p className="section-title">Average per visit by month</p>
        <TrendLine points={trends.points} />
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
