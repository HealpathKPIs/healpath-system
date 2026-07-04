import PageHead from '@/components/PageHead';
import KpiCard from '@/components/KpiCard';
import BarRank from '@/components/BarRank';
import { getKpis, getDrugs, getTrends } from '@/lib/queries';

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export default async function Pharmacy({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string } }) {
  const f = { month: searchParams.month ?? null, specialty: searchParams.specialty ?? null, doctor: searchParams.doctor ?? null };
  const [k, drugs, trends] = await Promise.all([getKpis(f), getDrugs(f), getTrends(f.specialty, f.doctor)]);

  const topAc = drugs.ac[0];
  const topBrand = drugs.brands[0];

  return (
    <>
      <PageHead title="Pharmacy" />

      <div className="grid kpirow" style={{ marginBottom: 20 }}>
        <KpiCard label="Avg Meds / Visit" value={k.avgMeds.toFixed(2)} delta={trends.delta.meds} />
        <KpiCard label="Total Visits" value={k.visits.toLocaleString()} />
        <KpiCard
          label={topAc ? `Top Ingredient · ${titleCase(topAc.label)}` : 'Top Ingredient'}
          value={topAc ? topAc.value.toLocaleString() : '—'}
        />
        <KpiCard
          label={topBrand ? `Top Brand · ${titleCase(topBrand.label)}` : 'Top Brand'}
          value={topBrand ? topBrand.value.toLocaleString() : '—'}
        />
      </div>

      <div className="grid lead">
        <div className="card">
          <p className="section-title">Top active ingredients</p>
          <BarRank data={drugs.ac} color="#10b981" />
        </div>
        <div className="card">
          <p className="section-title">Top brands</p>
          <BarRank data={drugs.brands} color="#6366f1" />
        </div>
      </div>
    </>
  );
}
