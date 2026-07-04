import BarRank from '@/components/BarRank';
import FilterBar from '@/components/FilterBar';
import TrendLine from '@/components/TrendLine';
import TrendArrow from '@/components/TrendArrow';
import { Suspense } from 'react';
import type { CSSProperties } from 'react';
import { getKpis, getDiseases, getDrugs, getTrends, listMonths, listSpecialties } from '@/lib/queries';

function OverviewKpi({ label, value, delta, tone }: { label: string; value: string | number; delta?: number; tone: string }) {
  return (
    <div className="overview-kpi" style={{ '--kpi-tone': tone } as CSSProperties}>
      <div className="overview-kpi-label">{label}</div>
      <div className="overview-kpi-value">{value}</div>
      {typeof delta === 'number' && <TrendArrow delta={delta} />}
    </div>
  );
}

export default async function Overview({ searchParams }: { searchParams: { month?: string; specialty?: string } }) {
  const f = { month: searchParams.month ?? null, specialty: searchParams.specialty ?? null };
  const [k, diseases, drugs, trends] = await Promise.all([
    getKpis(f), getDiseases(f, 5), getDrugs(f), getTrends(f.specialty),
  ]);
  return (
    <section className="overview-report">
      <div className="overview-header">
        <div>
          <p className="overview-eyebrow">HealPath BI Report</p>
          <h1 className="overview-title">Overview</h1>
          <p className="overview-subtitle">Executive utilization summary for the 2026 reporting window</p>
        </div>
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={listMonths()} specialties={listSpecialties()} />
        </Suspense>
      </div>

      <div className="overview-kpi-grid">
        <OverviewKpi label="Visits" value={k.visits.toLocaleString()} tone="#2f62d9" />
        <OverviewKpi label="Patients" value={k.patients.toLocaleString()} tone="#7f56d9" />
        <OverviewKpi label="Doctors" value={k.doctors} tone="#0891b2" />
        <OverviewKpi label="Meds / visit" value={k.avgMeds.toFixed(2)} delta={trends.delta.meds} tone="#635bff" />
        <OverviewKpi label="Labs / visit" value={k.avgLabs.toFixed(2)} delta={trends.delta.labs} tone="#16a36f" />
      </div>

      <div className="overview-visual-grid">
        <div className="overview-visual">
          <p className="section-title">Top 5 disease blocks</p>
          <BarRank data={diseases} color="#635bff" />
        </div>
        <div className="overview-visual">
          <p className="section-title">Top 5 active ingredients</p>
          <BarRank data={drugs.ac.slice(0, 5)} color="#16a36f" />
        </div>
      </div>

      <div className="overview-visual overview-trend">
        <p className="section-title">Average per visit by month</p>
        <TrendLine points={trends.points} />
      </div>
    </section>
  );
}
