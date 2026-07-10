'use client';
import { useEffect, useState } from 'react';
import pkg from '../../package.json';

// Settings (Sprint 27). Preferences persist in this browser (localStorage
// 'hp-settings') — the app has no user accounts, so there is no server-side
// profile to write to. "Show Executive Feed" is read by the Overview feed.

interface Settings {
  appearance: 'light' | 'dark' | 'system';
  animations: boolean;
  showFeed: boolean;
}
const DEFAULTS: Settings = { appearance: 'system', animations: true, showFeed: true };
const KEY = 'hp-settings';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '10px 2px', borderBottom: '1px solid var(--border-soft)', fontSize: 13.5 };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{ position: 'relative', width: 40, height: 22, borderRadius: 999, border: '1px solid var(--border)', background: checked ? 'var(--accent)' : 'var(--surface-3)', cursor: 'pointer', transition: 'background .15s ease', flex: '0 0 auto' }}
    >
      <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.25)', transition: 'left .15s ease' }} />
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [db, setDb] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    try { setSettings({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }); } catch { /* defaults */ }
    // Database status via the existing KPI endpoint — no new API.
    fetch('/api/kpis')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (typeof d?.visits === 'number') { setDb('connected'); setVisits(d.visits); } else setDb('unavailable'); })
      .catch(() => setDb('unavailable'));
  }, []);

  function update(patch: Partial<Settings>) {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* blocked */ }
      // Notify ThemeManager so appearance changes apply instantly (same tab).
      try { window.dispatchEvent(new Event('healpath:settings-changed')); } catch { /* SSR */ }
      return next;
    });
  }

  return (
    <>
      <div className="pagehead"><h1 className="pagetitle">Settings</h1></div>

      <div style={{ maxWidth: 640, display: 'grid', gap: 20 }}>
        <div className="card">
          <p className="section-title">Account</p>
          <div style={{ ...row, borderBottom: 0 }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Password</span>
            <button type="button" disabled title="Available once user accounts exist"
              style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-soft)', padding: '7px 12px', font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'not-allowed' }}>
              Change Password
            </button>
          </div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Placeholder — the dashboard uses shared access; there are no per-user accounts yet.</p>
        </div>

        <div className="card">
          <p className="section-title">Appearance</p>
          <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => update({ appearance: mode })}
                aria-pressed={settings.appearance === mode}
                style={{ flex: 1, height: 32, borderRadius: 7, border: 0, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, textTransform: 'capitalize', color: settings.appearance === mode ? '#fff' : 'var(--text-muted)', background: settings.appearance === mode ? 'var(--accent)' : 'transparent' }}>
                {mode}
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>Applied instantly across the app and saved on this device. System follows your operating-system setting.</p>
        </div>

        <div className="card">
          <p className="section-title">Dashboard</p>
          <div style={row}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Enable Animations</span>
            <Toggle checked={settings.animations} onChange={(v) => update({ animations: v })} label="Enable animations" />
          </div>
          <div style={{ ...row, borderBottom: 0 }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Show Executive Feed</span>
            <Toggle checked={settings.showFeed} onChange={(v) => update({ showFeed: v })} label="Show executive feed" />
          </div>
        </div>

        <div className="card">
          <p className="section-title">About</p>
          <div style={row}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Version</span>
            <b>v{pkg.version}</b>
          </div>
          <div style={{ ...row, borderBottom: 0 }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Database Status</span>
            <b style={{ color: db === 'connected' ? 'var(--success)' : db === 'checking' ? 'var(--text-soft)' : 'var(--danger)' }}>
              {db === 'checking' ? 'Checking…' : db === 'connected' ? `Connected · ${visits?.toLocaleString()} visits` : 'Unavailable — snapshot fallback'}
            </b>
          </div>
        </div>
      </div>
    </>
  );
}
