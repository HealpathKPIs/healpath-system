import BarRank from '@/components/BarRank';
import FilterBar from '@/components/FilterBar';
import TrendLine from '@/components/TrendLine';
import TrendArrow from '@/components/TrendArrow';
import { ExecutiveFeed, ExecutiveScenarioLayer, ExplainButton } from '@/components/ExecutiveExperience';
import AnimatedNumber from '@/components/AnimatedNumber';
import { Suspense } from 'react';
import type { CSSProperties } from 'react';
import { getKpis, getDiseases, getDrugs, getTrends, getDiagnostics, listSpecialties, listDoctors, resolveFilters } from '@/lib/queries';
import type { Filters, Kpis, RankRow, TrendResponse } from '@/lib/types';

function OverviewKpi({ label, value, delta, tone }: { label: string; value: string | number; delta?: number; tone: string }) {
  return (
    <div className="overview-kpi" style={{ '--kpi-tone': tone } as CSSProperties}>
      <div className="overview-kpi-label">{label}</div>
      <div className="overview-kpi-value"><AnimatedNumber value={value} /></div>
      {typeof delta === 'number' && <TrendArrow delta={delta} />}
    </div>
  );
}

type AlertTone = 'Critical' | 'Warning' | 'Positive';

function findVitaminD(rows: RankRow[]) {
  return rows.find((row) => {
    const label = row.label.toLowerCase();
    return label.includes('vitamin') && /\bd\b/.test(label);
  }) ?? null;
}

function buildVitaminDInsight(currentLabs: RankRow[], previousLabs: RankRow[]) {
  const current = findVitaminD(currentLabs);
  const previous = findVitaminD(previousLabs);
  if (!current) {
    return 'Vitamin D remains the most requested laboratory investigation.';
  }
  const delta = previous ? ` Delta: ${formatDelta(deltaPercent(current.value, previous.value))}.` : '';
  return `Vitamin D remains the most requested laboratory investigation. Current requests: ${current.value.toLocaleString()}.${delta}`;
}

function buildExecutiveAlerts(k: Kpis, drugs: { ac: RankRow[]; brands: RankRow[] }, trends: TrendResponse, currentLabs: RankRow[], previousLabs: RankRow[]) {
  const alerts: { tone: AlertTone; text: string }[] = [];
  if (trends.delta.meds > 0) {
    alerts.push({ tone: 'Critical', text: 'Average medications per visit increased compared to the previous month.' });
  } else if (trends.delta.meds < 0) {
    alerts.push({ tone: 'Positive', text: 'Average medications per visit decreased compared to the previous month.' });
  }
  if (trends.delta.labs > 0) {
    alerts.push({ tone: 'Warning', text: 'Average labs per visit increased compared to the previous month.' });
  } else if (trends.delta.labs < 0) {
    alerts.push({ tone: 'Positive', text: 'Average labs per visit decreased compared to the previous month.' });
  }
  alerts.push({ tone: 'Warning', text: buildVitaminDInsight(currentLabs, previousLabs) });
  if (drugs.ac[0]) {
    alerts.push({ tone: 'Positive', text: `${drugs.ac[0].label} remains the top prescribed medication at ${drugs.ac[0].value.toLocaleString()} prescriptions.` });
  }
  if (!alerts.length) {
    alerts.push({ tone: 'Positive', text: `${k.visits.toLocaleString()} visits are currently in the selected executive view.` });
  }
  const priority: Record<AlertTone, number> = { Critical: 0, Warning: 1, Positive: 2 };
  return alerts.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, 3);
}

function valueFor(rows: RankRow[], label: string) {
  return rows.find((row) => row.label === label)?.value ?? 0;
}

function deltaPercent(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function calculateMovers(current: RankRow[], previous: RankRow[]) {
  const labels = [...current.map((row) => row.label), ...previous.map((row) => row.label)]
    .filter((label, index, all) => all.indexOf(label) === index);
  const rows = labels.map((label) => {
    const currentValue = valueFor(current, label);
    const previousValue = valueFor(previous, label);
    return { label, currentValue, previousValue, delta: deltaPercent(currentValue, previousValue) };
  });
  if (!rows.length) return { increase: null, decrease: null };
  return {
    increase: rows.reduce((best, row) => (row.delta > best.delta ? row : best), rows[0]),
    decrease: rows.reduce((best, row) => (row.delta < best.delta ? row : best), rows[0]),
  };
}

function formatMoverValue(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatDelta(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function comparisonStatus(diff: number) {
  if (diff > 0.05) return '▲ Above Average';
  if (diff < -0.05) return '▼ Below Average';
  return '≈ Average';
}

function ExecutiveAlertBar({ alerts }: { alerts: ReturnType<typeof buildExecutiveAlerts> }) {
  const toneStyle: Record<AlertTone, { icon: string; color: string; bg: string }> = {
    Critical: { icon: '!', color: 'var(--danger)', bg: 'linear-gradient(135deg, color-mix(in srgb, var(--danger) 16%, var(--surface)), var(--surface))' },
    Warning: { icon: 'i', color: 'var(--warning)', bg: 'linear-gradient(135deg, color-mix(in srgb, var(--warning) 16%, var(--surface)), var(--surface))' },
    Positive: { icon: '+', color: 'var(--success)', bg: 'linear-gradient(135deg, color-mix(in srgb, var(--success) 16%, var(--surface)), var(--surface))' },
  };
  return (
    <div className="card" style={{ marginBottom: 20, display: 'grid', gap: 14, background: 'var(--surface)' }}>
      <p className="section-title">Executive alerts</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {alerts.map((alert) => (
          <div key={`${alert.tone}-${alert.text}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 15px', background: toneStyle[alert.tone].bg, boxShadow: '0 8px 18px rgba(15,23,42,.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: toneStyle[alert.tone].color, fontWeight: 800 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, display: 'inline-grid', placeItems: 'center', background: 'var(--surface)', border: '1px solid currentColor', fontSize: 12 }}>{toneStyle[alert.tone].icon}</span>
              {alert.tone}
            </div>
            <div style={{ marginTop: 7, color: 'var(--text-soft)', lineHeight: 1.45, fontWeight: 600 }}>{alert.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoversPanel({ movers }: {
  movers: {
    metrics: ReturnType<typeof calculateMovers>;
  };
}) {
  const rows = [
    { direction: '▲ Biggest Increase', item: movers.metrics.increase, tone: 'var(--success)' },
    { direction: '▼ Biggest Decrease', item: movers.metrics.decrease, tone: 'var(--danger)' },
  ].filter((row) => row.item);

  return (
    <div className="card" style={{ background: 'var(--surface)' }}>
      <p className="section-title">Biggest movers</p>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((row) => (
          <div key={row.direction} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 12, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '13px 14px', background: 'var(--surface-2)' }}>
            <span style={{ color: row.tone, fontWeight: 800 }}>{row.direction}</span>
            <span><b>{row.item!.label}</b><br /><small style={{ color: 'var(--text-soft)', fontWeight: 700 }}>Latest vs previous month</small></span>
            <span style={{ textAlign: 'right', color: 'var(--text-soft)' }}>{formatMoverValue(row.item!.currentValue)} vs {formatMoverValue(row.item!.previousValue)}<br /><b style={{ color: row.tone }}>{formatDelta(row.item!.delta)}</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DoctorComparison({ doctor, k, peer }: { doctor: string; k: Kpis; peer: Kpis }) {
  const diff = k.avgMeds - peer.avgMeds;
  const status = comparisonStatus(diff);
  const statusColor = diff > 0.05 ? 'var(--success)' : diff < -0.05 ? 'var(--danger)' : 'var(--text-muted)';
  return (
    <div className="card" style={{ background: 'var(--surface)' }}>
      <p className="section-title">Smart comparison</p>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ color: 'var(--text-soft)', fontWeight: 700, fontSize: 12 }}>Doctor</div>
            <b style={{ fontSize: 20 }}>{doctor}</b>
          </div>
          <span style={{ borderRadius: 999, padding: '7px 10px', color: statusColor, background: 'var(--surface)', border: '1px solid currentColor', fontWeight: 800 }}>{status}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <span style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface-2)' }}>Visits<br /><b>{k.visits.toLocaleString()}</b></span>
          <span style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface-2)' }}>Avg Medications / Visit<br /><b>{k.avgMeds.toFixed(2)}</b></span>
          <span style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface-2)' }}>Peer Average<br /><b>{peer.avgMeds.toFixed(2)}</b></span>
          <span style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface-2)' }}>Difference<br /><b style={{ color: statusColor }}>{diff > 0 ? '+' : ''}{diff.toFixed(2)}</b></span>
        </div>
      </div>
    </div>
  );
}

// Executive Summary — up to 3 concise, deterministic observations from data the
// page already loaded. No AI/LLM, no new SQL.
function buildExecutiveSummary(k: Kpis, diseases: RankRow[], drugs: { ac: RankRow[]; brands: RankRow[] }, trends: TrendResponse, latestLabs: RankRow[]): string[] {
  const out: string[] = [];
  const dm = trends.delta.meds;
  const utilization = dm > 0.05
    ? `rose to ${k.avgMeds.toFixed(2)} medications per visit`
    : dm < -0.05
      ? `eased to ${k.avgMeds.toFixed(2)} medications per visit`
      : `remained stable at ${k.avgMeds.toFixed(2)} medications per visit`;
  out.push(`Medication utilization ${utilization} month-over-month.`);
  if (latestLabs[0]) out.push(`${latestLabs[0].label} is the leading laboratory investigation.`);
  if (diseases[0]) out.push(`${diseases[0].label} accounts for the largest share of diagnoses.`);
  if (out.length < 3 && drugs.ac[0]) {
    out.push(`${drugs.ac[0].label} is the most prescribed active ingredient.`);
  }
  return out.slice(0, 3);
}

function ExecutiveSummary({ points }: { points: string[] }) {
  if (!points.length) return null;
  return (
    <div className="card" style={{ marginBottom: 20, background: 'var(--surface)' }}>
      <p className="section-title">Executive Summary</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 11 }}>
        {points.map((text, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, color: 'var(--text)', fontSize: 14.5, fontWeight: 500, lineHeight: 1.5, letterSpacing: '-0.01em' }}>
            <span aria-hidden style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--accent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function monthsFromTrend(trends: TrendResponse) {
  return trends.points.map((point) => point.month);
}

export default async function Overview({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string; sel?: string; selv?: string } }) {
  const f = resolveFilters(searchParams, { doctor: true, drug: true, disease: true });
  const [k, diseases, drugs, trends] = await Promise.all([
    getKpis(f), getDiseases(f, 5), getDrugs(f), getTrends(f.specialty, f.doctor, f.drug, f.disease),
  ]);
  const latestMonth = trends.points[trends.points.length - 1]?.month ?? null;
  const previousMonth = trends.points[trends.points.length - 2]?.month ?? null;
  const [latestKpis, previousKpis, latestDiagnostics, previousDiagnostics, peerKpis] = await Promise.all([
    latestMonth ? getKpis({ ...f, month: latestMonth }) : Promise.resolve(null),
    previousMonth ? getKpis({ ...f, month: previousMonth }) : Promise.resolve(null),
    latestMonth ? getDiagnostics({ ...f, month: latestMonth }) : Promise.resolve({ labs: [], scans: [] }),
    previousMonth ? getDiagnostics({ ...f, month: previousMonth }) : Promise.resolve({ labs: [], scans: [] }),
    f.doctor ? getKpis({ ...f, doctor: null }) : Promise.resolve(null),
  ]);
  const alerts = buildExecutiveAlerts(k, drugs, trends, latestDiagnostics.labs, previousDiagnostics.labs);
  const latestMetrics: RankRow[] = latestKpis && trends.points.length ? [
    { label: 'Avg Medications / Visit', value: trends.points[trends.points.length - 1].meds },
    { label: 'Avg Labs / Visit', value: trends.points[trends.points.length - 1].labs },
    { label: 'Doctors', value: latestKpis.doctors },
  ] : [];
  const previousMetrics: RankRow[] = previousKpis && trends.points.length > 1 ? [
    { label: 'Avg Medications / Visit', value: trends.points[trends.points.length - 2].meds },
    { label: 'Avg Labs / Visit', value: trends.points[trends.points.length - 2].labs },
    { label: 'Doctors', value: previousKpis.doctors },
  ] : [];
  const movers = {
    metrics: calculateMovers(latestMetrics, previousMetrics),
  };
  const summary = buildExecutiveSummary(k, diseases, drugs, trends, latestDiagnostics.labs);

  return (
    <section className="overview-report">
      <ExecutiveScenarioLayer k={k} doctor={f.doctor} peerKpis={peerKpis} drugs={drugs} diagnostics={latestDiagnostics} trends={trends} />
      <div className="overview-header">
        <div>
          <p className="overview-eyebrow">HealPath BI Report</p>
          <h1 className="overview-title">Overview</h1>
          <p className="overview-subtitle">Executive utilization summary for the 2026 reporting window</p>
        </div>
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={monthsFromTrend(trends)} specialties={listSpecialties()} doctors={listDoctors()} />
        </Suspense>
      </div>

      <ExecutiveSummary points={summary} />

      <ExecutiveAlertBar alerts={alerts} />

      <div className="grid two" style={{ marginBottom: 20 }}>
        <MoversPanel movers={movers} />
        {f.doctor && peerKpis ? <DoctorComparison doctor={f.doctor} k={k} peer={peerKpis} /> : null}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <p className="section-title" style={{ margin: 0 }}>Top 5 disease blocks</p>
            <ExplainButton title="Top 5 disease blocks" rows={diseases} />
          </div>
          <BarRank data={diseases} color="#635bff" kind="disease" />
        </div>
        <div className="overview-visual">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <p className="section-title" style={{ margin: 0 }}>Top 5 active ingredients</p>
            <ExplainButton title="Top 5 active ingredients" rows={drugs.ac.slice(0, 5)} />
          </div>
          <BarRank data={drugs.ac.slice(0, 5)} color="#16a36f" kind="drug" />
        </div>
      </div>

      <div className="overview-visual overview-trend">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <p className="section-title" style={{ margin: 0 }}>Average per visit by month</p>
          <ExplainButton title="Average per visit by month" trend={trends.points} />
        </div>
        <TrendLine points={trends.points} delta={trends.delta} />
      </div>

      <ExecutiveFeed k={k} drugs={drugs} diagnostics={latestDiagnostics} trends={trends} doctor={f.doctor} />
    </section>
  );
}
