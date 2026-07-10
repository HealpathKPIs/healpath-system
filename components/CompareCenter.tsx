'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

// Executive Compare Center — a reusable right-side drawer. It builds each side's
// profile ONLY from the existing API routes (no new API/SQL/backend) and its
// Quick Actions reuse the existing page routing + filters.

type CompareType = 'doctor' | 'medication' | 'month';

interface Profile {
  visits?: number;
  avgMeds?: number;
  prescriptions?: number;
  topMedication?: string;
  topLaboratory?: string;
  topSpecialty?: string;
  topTrend?: string;
}

const MONTH_LABEL: Record<string, string> = {
  '2026-01': 'Jan 2026', '2026-02': 'Feb 2026', '2026-03': 'Mar 2026',
  '2026-04': 'Apr 2026', '2026-05': 'May 2026', '2026-06': 'Jun 2026',
};

const TITLE = { doctor: 'Doctor', medication: 'Medication', month: 'Month' } as const;

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function fetchJson(url: string): Promise<any> {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

function trendLabel(delta?: number): string | undefined {
  if (typeof delta !== 'number') return undefined;
  if (delta > 0.05) return 'Increasing';
  if (delta < -0.05) return 'Decreasing';
  return 'Stable';
}

// Reuse the existing page filters for routing/quick-actions.
function entityQuery(type: CompareType, value: string): string {
  if (type === 'doctor') return `doctor=${encodeURIComponent(value)}`;
  if (type === 'month') return `month=${encodeURIComponent(value)}`;
  return `sel=drug&selv=${encodeURIComponent(value)}`;
}

async function buildProfile(type: CompareType, value: string, drugsAll: any): Promise<Profile> {
  if (type === 'medication') {
    const all = [...(drugsAll?.ac ?? []), ...(drugsAll?.brands ?? [])];
    const hit = all.find((r: any) => String(r.label).toLowerCase() === value.toLowerCase());
    return { prescriptions: hit ? Number(hit.value) : undefined };
  }
  const qf = type === 'doctor' ? `doctor=${encodeURIComponent(value)}` : `month=${encodeURIComponent(value)}`;
  const [kpis, drugs, diag, trends, specs] = await Promise.all([
    fetchJson(`/api/kpis?${qf}`),
    fetchJson(`/api/drugs?${qf}`),
    fetchJson(`/api/diagnostics?${qf}`),
    fetchJson(type === 'doctor' ? `/api/trends?${qf}` : '/api/trends'),
    fetchJson(type === 'month' ? `/api/specialties?${qf}` : '/api/specialties'),
  ]);
  const p: Profile = {};
  if (kpis && typeof kpis.visits === 'number') { p.visits = kpis.visits; p.avgMeds = kpis.avgMeds; }
  if (drugs?.ac?.[0]?.label) p.topMedication = titleCase(drugs.ac[0].label);
  if (diag?.labs?.[0]?.label) p.topLaboratory = diag.labs[0].label;
  if (type === 'month' && specs?.ranking?.[0]?.label) p.topSpecialty = specs.ranking[0].label;
  if (type === 'doctor' && Array.isArray(specs?.doctors)) {
    const d = specs.doctors.find((x: any) => x.practitioner === value);
    if (d?.specialty) p.topSpecialty = d.specialty;
  }
  if (type === 'doctor' && trends?.delta) p.topTrend = trendLabel(trends.delta.meds);
  if (type === 'month' && Array.isArray(trends?.points)) {
    const idx = trends.points.findIndex((pt: any) => pt.month === value);
    if (idx > 0) p.topTrend = trendLabel(trends.points[idx].meds - trends.points[idx - 1].meds);
    else if (idx === 0) p.topTrend = 'Stable';
  }
  return p;
}

const METRICS: { key: keyof Profile; label: string; numeric: boolean; decimals?: number }[] = [
  { key: 'visits', label: 'Visits', numeric: true },
  { key: 'avgMeds', label: 'Average Medications', numeric: true, decimals: 2 },
  { key: 'prescriptions', label: 'Prescriptions', numeric: true },
  { key: 'topMedication', label: 'Top Medication', numeric: false },
  { key: 'topLaboratory', label: 'Top Laboratory', numeric: false },
  { key: 'topSpecialty', label: 'Top Specialty', numeric: false },
  { key: 'topTrend', label: 'Top Trend', numeric: false },
];

const cardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--surface)', boxShadow: 'var(--shadow-xs)' };
const selectStyle: React.CSSProperties = { width: '100%', height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', padding: '0 12px', font: 'inherit', fontSize: 13.5 };

export default function CompareCenter({ open, onClose, months, doctors }:
  { open: boolean; onClose: () => void; months: string[]; doctors: string[] }) {
  const router = useRouter();
  const [type, setType] = useState<CompareType>('doctor');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [leftP, setLeftP] = useState<Profile | null>(null);
  const [rightP, setRightP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [drugsAll, setDrugsAll] = useState<any>(null);

  // Load the top medications (existing query) once, for the medication dropdowns + counts.
  useEffect(() => { if (open && !drugsAll) fetchJson('/api/drugs').then(setDrugsAll); }, [open, drugsAll]);

  // Reset selections when the comparison type changes.
  useEffect(() => { setLeft(''); setRight(''); setLeftP(null); setRightP(null); }, [type]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  // Build both profiles once both sides are chosen.
  useEffect(() => {
    if (!open || !left || !right) { setLeftP(null); setRightP(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([buildProfile(type, left, drugsAll), buildProfile(type, right, drugsAll)]).then(([l, r]) => {
      if (!cancelled) { setLeftP(l); setRightP(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open, type, left, right, drugsAll]);

  const medicationOptions: string[] = drugsAll
    ? Array.from(new Set([...(drugsAll.ac ?? []), ...(drugsAll.brands ?? [])].map((r: any) => String(r.label))))
    : [];
  const options = type === 'doctor' ? doctors : type === 'month' ? months : medicationOptions;
  const optionLabel = (v: string) => (type === 'month' ? (MONTH_LABEL[v] ?? v) : type === 'medication' ? titleCase(v) : v);

  const go = useCallback((href: string) => { onClose(); router.push(href); }, [onClose, router]);

  if (!open) return null;

  // Portal to <body>: the drawer is mounted inside .filters (backdrop-filter)
  // and under PageTransition (will-change: transform) — both create containing
  // blocks that re-anchor position:fixed and crop the drawer header. Rendering
  // at body level restores true viewport positioning without layout changes.
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.30)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <aside className="compare-panel" role="dialog" aria-modal="true" aria-label="Compare Center"
        style={{ width: 'min(100%, 500px)', height: '100%', overflowY: 'auto', background: 'var(--bg)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 720, letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>⚖ Compare Center</h2>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
        </div>

        {/* comparison type */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, marginBottom: 16 }}>
          {(['doctor', 'medication', 'month'] as CompareType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              style={{ flex: 1, height: 34, borderRadius: 7, border: 0, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: type === t ? '#fff' : 'var(--text-muted)', background: type === t ? 'var(--accent)' : 'transparent' }}>
              {TITLE[t]}
            </button>
          ))}
        </div>

        {/* selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-soft)', marginBottom: 6 }}>Left</div>
            <select aria-label="Left" value={left} onChange={(e) => setLeft(e.target.value)} style={selectStyle}>
              <option value="">Select {TITLE[type].toLowerCase()}…</option>
              {options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-soft)', marginBottom: 6 }}>Right</div>
            <select aria-label="Right" value={right} onChange={(e) => setRight(e.target.value)} style={selectStyle}>
              <option value="">Select {TITLE[type].toLowerCase()}…</option>
              {options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
            </select>
          </div>
        </div>

        {/* output */}
        {(!left || !right) ? (
          <div style={{ ...cardStyle, color: 'var(--text-soft)', fontSize: 13.5, textAlign: 'center', padding: '28px 16px' }}>
            Select both {TITLE[type].toLowerCase()}s to compare.
          </div>
        ) : loading || !leftP || !rightP ? (
          <div style={{ ...cardStyle, color: 'var(--text-soft)', fontSize: 13.5, textAlign: 'center', padding: '28px 16px' }}>Comparing…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              {METRICS.map((m) => {
                const lv = leftP[m.key]; const rv = rightP[m.key];
                if (lv == null || rv == null) return null; // hide unavailable — never fabricate
                let delta: React.ReactNode = null;
                if (m.numeric && typeof lv === 'number' && typeof rv === 'number' && rv !== 0) {
                  const pct = ((lv - rv) / rv) * 100;
                  const color = pct > 0.5 ? 'var(--success)' : pct < -0.5 ? 'var(--danger)' : 'var(--text-muted)';
                  const sym = pct > 0.5 ? '▲' : pct < -0.5 ? '▼' : '≈';
                  delta = <span style={{ color, fontWeight: 700, fontSize: 12 }}>{sym} {pct > 0 ? '+' : ''}{pct.toFixed(0)}%</span>;
                }
                const fmt = (v: number | string) => typeof v === 'number' ? v.toLocaleString(undefined, { minimumFractionDigits: m.decimals ?? 0, maximumFractionDigits: m.decimals ?? 0 }) : v;
                return (
                  <div key={m.key} style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>{m.label}</span>
                      {delta}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontWeight: 680, color: 'var(--text-strong)', fontSize: m.numeric ? 20 : 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(lv)}>{fmt(lv)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-soft)', fontWeight: 600 }}>vs</span>
                      <span style={{ fontWeight: 680, color: 'var(--text-strong)', fontSize: m.numeric ? 20 : 14, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(rv)}>{fmt(rv)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* quick actions */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-soft)', marginBottom: 8 }}>Quick Actions</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button type="button" style={quickBtn} onClick={() => go(`/?${entityQuery(type, left)}`)}>Open Left in Dashboard</button>
                <button type="button" style={quickBtn} onClick={() => go(`/?${entityQuery(type, right)}`)}>Open Right in Dashboard</button>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <button type="button" style={quickBtn} onClick={() => go(`/trends?${entityQuery(type, left)}`)}>Trends</button>
                  <button type="button" style={quickBtn} onClick={() => go(`/pharmacy?${entityQuery(type, left)}`)}>Pharmacy</button>
                  <button type="button" style={quickBtn} onClick={() => go(`/diagnostics?${entityQuery(type, left)}`)}>Diagnostics</button>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
      <style>{`.compare-panel{animation:compareIn 200ms cubic-bezier(0.16,1,0.3,1) both}@keyframes compareIn{from{opacity:.4;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}@media (prefers-reduced-motion: reduce){.compare-panel{animation:none}}`}</style>
    </div>,
    document.body,
  );
}

const quickBtn: React.CSSProperties = { width: '100%', height: 38, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600 };
