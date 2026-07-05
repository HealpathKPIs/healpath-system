import PageHead from '@/components/PageHead';
import KpiCard from '@/components/KpiCard';
import BarRank from '@/components/BarRank';
import SearchBox from '@/components/SearchBox';
import { getKpis, getDiagnostics, getTrends, resolveFilters } from '@/lib/queries';

export default async function Diagnostics({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string; sel?: string; selv?: string; q?: string } }) {
  // Labs & Scans honours a disease cross-filter but not a drug one.
  const f = resolveFilters(searchParams, { doctor: true, drug: false, disease: true });
  const [k, diag, trends] = await Promise.all([getKpis(f), getDiagnostics(f), getTrends(f.specialty, f.doctor, f.drug, f.disease)]);
  return (
    <>
      <PageHead title="Labs & Scans" />
      <SearchBox scope="diagnostics" placeholder="Search lab or scan…" />
      <div className="grid kpirow" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <KpiCard label="Labs / visit" value={k.avgLabs.toFixed(2)} delta={trends.delta.labs} />
        <KpiCard label="Scans / visit" value={k.avgScans.toFixed(2)} delta={trends.delta.scans} />
      </div>
      <div className="grid two">
        <div className="card">
          <p className="section-title">Top lab tests</p>
          <BarRank data={diag.labs} color="#1baf7a" />
        </div>
        <div className="card">
          <p className="section-title">Top scans</p>
          <BarRank data={diag.scans} color="#378add" />
        </div>
      </div>
    </>
  );
}
