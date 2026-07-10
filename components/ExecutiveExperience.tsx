'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useDashboard } from '@/lib/dashboard-context';
import type { Kpis, RankRow, TrendResponse } from '@/lib/types';

type ScenarioType = 'Doctor' | 'Medication' | 'Laboratory';

interface Scenario {
  type: ScenarioType;
  name: string;
}

interface DiagnosticsSummary {
  labs: RankRow[];
  scans?: RankRow[];
}

function trendText(delta: number, label: string) {
  if (delta > 0.05) return `${label} is trending upward.`;
  if (delta < -0.05) return `${label} is trending downward.`;
  return `${label} remained stable.`;
}

function statusText(delta: number) {
  if (delta > 0.05) return 'Above Average';
  if (delta < -0.05) return 'Below Average';
  return 'Average';
}

function formatDiff(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function openScenario(type: ScenarioType, name: string) {
  window.dispatchEvent(new CustomEvent('healpath:scenario-open', { detail: { type, name } }));
}

export function ExecutiveScenarioLayer({
  k,
  doctor,
  peerKpis,
  drugs,
  diagnostics,
  trends,
}: {
  k: Kpis;
  doctor?: string | null;
  peerKpis?: Kpis | null;
  drugs: { ac: RankRow[]; brands: RankRow[] };
  diagnostics: DiagnosticsSummary;
  trends: TrendResponse;
}) {
  const { selection, clear } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [scenario, setScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<Scenario>).detail;
      if (detail?.type && detail.name) setScenario(detail);
    }
    window.addEventListener('healpath:scenario-open', onOpen);
    return () => window.removeEventListener('healpath:scenario-open', onOpen);
  }, []);

  useEffect(() => {
    if (selection?.type === 'doctor') setScenario({ type: 'Doctor', name: selection.value });
    else if (selection?.type === 'drug') setScenario({ type: 'Medication', name: selection.value });
    else if (!selection) setScenario(null); // selection cleared elsewhere -> hide the panel
  }, [selection]);

  // Closing clears the selection everywhere it lives: local panel state, the
  // DashboardContext, and the URL params that mirror it (sel/selv + doctor).
  const close = useCallback(() => {
    setScenario(null);
    clear();
    const next = new URLSearchParams(params.toString());
    next.delete('sel');
    next.delete('selv');
    if (selection?.type === 'doctor') next.delete('doctor');
    if (next.toString() !== params.toString()) {
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }
  }, [clear, params, pathname, router, selection]);

  const diff = doctor && peerKpis ? k.avgMeds - peerKpis.avgMeds : null;
  const topTrend = Math.abs(trends.delta.meds) >= Math.abs(trends.delta.labs)
    ? trendText(trends.delta.meds, 'Medication utilization')
    : trendText(trends.delta.labs, 'Laboratory utilization');

  const rows = scenario ? [
    ['Selected Entity', scenario.name],
    ['Visits', k.visits ? k.visits.toLocaleString() : null],
    ['Patients', k.patients ? k.patients.toLocaleString() : null],
    ['Top Medication', drugs.ac[0]?.label],
    ['Top Laboratory', diagnostics.labs[0]?.label],
    ['Average Medications / Visit', k.avgMeds.toFixed(2)],
    ['Peer Average', scenario.type === 'Doctor' && peerKpis ? peerKpis.avgMeds.toFixed(2) : null],
    ['Difference', scenario.type === 'Doctor' && diff !== null ? formatDiff(diff) : null],
    ['Top Trend', topTrend],
  ].filter((row): row is [string, string] => Boolean(row[1])) : [];

  // Compact floating panel (Sprint 27): shows only while an entity is selected,
  // sits bottom-right without occupying the viewport height, and its X clears
  // the selection. Non-modal — no backdrop, the dashboard stays interactive.
  if (!scenario) return null;

  return (
    <aside
      aria-label="Executive Scenario"
      className="scenario-pop"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 60,
        width: 'min(350px, calc(100vw - 32px))',
        maxHeight: '58vh',
        overflowY: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-lg)',
        padding: '16px 18px',
        display: 'grid',
        alignContent: 'start',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent-ink)' }}>Executive Scenario</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scenario.type}</h2>
        </div>
        <button
          type="button"
          aria-label="Close scenario and clear selection"
          onClick={close}
          style={{ flex: '0 0 auto', border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 999, width: 28, height: 28, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, display: 'grid', placeItems: 'center' }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', borderBottom: '1px solid var(--border-soft)', padding: '5px 1px', fontSize: 13 }}>
            <span style={{ color: 'var(--text-soft)', fontSize: 11.5, fontWeight: 700, flex: '0 0 auto' }}>{label}</span>
            <b style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>{value}</b>
          </div>
        ))}
      </div>
      {scenario.type === 'Doctor' && diff !== null ? (
        <span style={{ justifySelf: 'start', borderRadius: 999, padding: '5px 10px', fontSize: 12, color: diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid currentColor', fontWeight: 800 }}>
          {statusText(diff)}
        </span>
      ) : null}
      <style>{`.scenario-pop{animation:scenarioIn 180ms cubic-bezier(0.16,1,0.3,1) both}@keyframes scenarioIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@media (prefers-reduced-motion: reduce){.scenario-pop{animation:none}}`}</style>
    </aside>
  );
}

export function ExplainButton({ title, rows, trend }: { title: string; rows?: RankRow[]; trend?: TrendResponse['points'] }) {
  const [open, setOpen] = useState(false);
  const sentences = useMemo(() => {
    if (trend?.length) {
      const first = trend[0];
      const last = trend[trend.length - 1];
      const direction = last.meds > first.meds ? 'Medication utilization rose over the period.' : last.meds < first.meds ? 'Medication utilization declined over the period.' : 'Medication utilization was broadly stable.';
      return [
        direction,
        `Latest month visits: ${last.visits?.toLocaleString() ?? 'not available'}.`,
        trendText(last.labs - first.labs, 'Laboratory utilization'),
        'Use this view to spot utilization shifts before they become operational pressure.',
      ];
    }
    const sorted = [...(rows ?? [])].sort((a, b) => b.value - a.value);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];
    return [
      highest ? `${highest.label} is the dominant category at ${highest.value.toLocaleString()}.` : 'No dominant category is available.',
      lowest && lowest !== highest ? `${lowest.label} is the lowest visible category at ${lowest.value.toLocaleString()}.` : '',
      'The ordering is based on the current dashboard filters.',
      'Focus review on the dominant category first.',
    ].filter(Boolean);
  }, [rows, trend]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={() => setOpen((value) => !value)} style={{ border: '1px solid var(--border)', borderRadius: 999, background: 'var(--surface)', padding: '5px 9px', fontWeight: 800, color: 'var(--text-soft)', cursor: 'pointer' }}>
        ⓘ Explain
      </button>
      {open ? (
        <span style={{ position: 'absolute', top: 34, right: 0, zIndex: 20, width: 280, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', boxShadow: '0 18px 40px rgba(15,23,42,.14)', padding: 14, display: 'grid', gap: 8 }}>
          <b>{title}</b>
          {sentences.slice(0, 5).map((sentence) => <span key={sentence} style={{ color: 'var(--text-soft)', lineHeight: 1.4 }}>{sentence}</span>)}
        </span>
      ) : null}
    </span>
  );
}

export function ExecutiveFeed({ k, drugs, diagnostics, trends, doctor }: {
  k: Kpis;
  drugs: { ac: RankRow[]; brands: RankRow[] };
  diagnostics: DiagnosticsSummary;
  trends: TrendResponse;
  doctor?: string | null;
}) {
  // Respect the Settings → Dashboard → "Show Executive Feed" preference.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('hp-settings') ?? '{}');
      if (s.showFeed === false) setVisible(false);
    } catch { /* corrupted settings -> default visible */ }
  }, []);

  const cards = [
    { icon: '🧪', text: `${diagnostics.labs[0]?.label ?? 'Vitamin D'} remains the leading laboratory investigation.`, type: 'Laboratory' as const, name: diagnostics.labs[0]?.label ?? 'Vitamin D' },
    { icon: '💊', text: `${drugs.ac[0]?.label ?? 'Top medication'} remains the highest prescribed medication.`, type: 'Medication' as const, name: drugs.ac[0]?.label ?? 'Top medication' },
    { icon: '👨‍⚕️', text: doctor ? `${doctor} is selected for executive comparison.` : `${k.doctors.toLocaleString()} doctors are active in the selected view.`, type: 'Doctor' as const, name: doctor ?? 'Doctor cohort' },
    { icon: '📈', text: trendText(trends.delta.meds, 'Medication utilization'), type: 'Medication' as const, name: drugs.ac[0]?.label ?? 'Medication utilization' },
    { icon: '🧬', text: trendText(trends.delta.labs, 'Average laboratory utilization'), type: 'Laboratory' as const, name: diagnostics.labs[0]?.label ?? 'Laboratory utilization' },
  ];

  if (!visible) return null;

  return (
    <div className="card" style={{ marginTop: 20, display: 'grid', gap: 12 }}>
      <p className="section-title">Executive Feed</p>
      <div style={{ display: 'grid', gap: 8, maxHeight: 310, overflow: 'auto' }}>
        {cards.map((card) => (
          <button
            key={`${card.icon}-${card.text}`}
            type="button"
            onClick={() => openScenario(card.type, card.name)}
            style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 12, textAlign: 'left', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', padding: '12px 14px', cursor: 'pointer', boxShadow: '0 8px 18px rgba(15,23,42,.05)' }}
          >
            <span aria-hidden="true">{card.icon}</span>
            <span style={{ color: 'var(--text-soft)', fontWeight: 700 }}>{card.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
