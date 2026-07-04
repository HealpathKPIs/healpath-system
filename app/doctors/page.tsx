import PageHead from '@/components/PageHead';
import KpiCard from '@/components/KpiCard';
import BarRank from '@/components/BarRank';
import DataTable from '@/components/DataTable';
import { getKpis, getSpecialties, getTrends } from '@/lib/queries';
import type { RankRow } from '@/lib/types';

export default async function Doctors({ searchParams }: { searchParams: { month?: string; specialty?: string } }) {
  const f = { month: searchParams.month ?? null, specialty: searchParams.specialty ?? null };
  const [k, { ranking, doctors }, trends] = await Promise.all([
    getKpis(f), getSpecialties(f), getTrends(f.specialty),
  ]);

  // Presentation-only shaping of existing data — top performers by visit volume.
  const topDoctors: RankRow[] = doctors.slice(0, 8).map((d) => ({ label: d.practitioner, value: d.visits }));

  return (
    <>
      <PageHead title="Doctor & Specialty" />

      <div className="grid kpirow" style={{ marginBottom: 20 }}>
        <KpiCard label="Total Visits" value={k.visits.toLocaleString()} />
        <KpiCard label="Avg Meds / Visit" value={k.avgMeds.toFixed(2)} delta={trends.delta.meds} />
        <KpiCard label="Avg Labs / Visit" value={k.avgLabs.toFixed(2)} delta={trends.delta.labs} />
        <KpiCard label="Avg Scans / Visit" value={k.avgScans.toFixed(2)} delta={trends.delta.scans} />
      </div>

      <div className="grid two" style={{ marginBottom: 20 }}>
        <div className="card">
          <p className="section-title">Top performing doctors</p>
          <BarRank data={topDoctors} color="#6366f1" />
        </div>
        <div className="card">
          <p className="section-title">Visits by specialty</p>
          <BarRank data={ranking} color="#2563eb" />
        </div>
      </div>

      <div className="card">
        <p className="section-title">Doctor performance matrix — top 20 by volume</p>
        <DataTable searchable searchKey="practitioner"
          rows={doctors}
          columns={[
            { key: 'practitioner', label: 'Doctor' },
            { key: 'specialty', label: 'Specialty' },
            { key: 'visits', label: 'Visits', num: true },
            { key: 'medsPerVisit', label: 'Meds/V', num: true, decimals: 2 },
            { key: 'labsPerVisit', label: 'Labs/V', num: true, decimals: 2 },
          ]} />
      </div>
    </>
  );
}
