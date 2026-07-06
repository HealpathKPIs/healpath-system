'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  '/': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  '/diseases': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
  ),
  '/pharmacy': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 20.5-7-7a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7Z" /><path d="m8.5 8.5 7 7" /></svg>
  ),
  '/doctors': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  ),
  '/diagnostics': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6.5L4.4 17a2 2 0 0 0 1.7 3h11.8a2 2 0 0 0 1.7-3L15 8.5V2" /><path d="M8 2h8" /><path d="M7 14h10" /></svg>
  ),
  '/trends': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
  ),
};

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/diseases', label: 'Disease & Diagnosis' },
  { href: '/pharmacy', label: 'Pharmacy' },
  { href: '/doctors', label: 'Doctor & Specialty' },
  { href: '/diagnostics', label: 'Labs & Scans' },
  { href: '/trends', label: 'Trends' },
];

function NavLinks({ path, query = '' }: { path: string; query?: string }) {
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={`${l.href}${query ? `?${query}` : ''}`} className={`navlink ${path === l.href ? 'active' : ''}`} aria-current={path === l.href ? 'page' : undefined}>
          <span className="nav-icon">{ICONS[l.href]}</span>
          <span className="nav-label">{l.label}</span>
        </Link>
      ))}
    </>
  );
}

function PreservedNavLinks({ path }: { path: string }) {
  const params = useSearchParams();
  const preserve = new URLSearchParams();
  ['month', 'specialty', 'doctor', 'sel', 'selv'].forEach((key) => {
    const value = params.get(key);
    if (value) preserve.set(key, value);
  });
  const query = preserve.toString();
  return <NavLinks path={path} query={query} />;
}

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="brand">Heal<span>Path</span><span className="nav-badge">BI</span></div>
      <button
        type="button"
        aria-label="Open command palette"
        onClick={() => window.dispatchEvent(new Event('healpath:command-open'))}
        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', margin: '4px 0 8px', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-xs)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
        <kbd style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}>Ctrl K</kbd>
      </button>
      <div className="nav-section">Analytics</div>
      <div className="nav-scroll">
        <Suspense fallback={<NavLinks path={path} />}>
          <PreservedNavLinks path={path} />
        </Suspense>
      </div>
      <div className="nav-foot">
        <span className="nav-foot-dot" />
        <span className="nav-foot-text"><b>2026 Reporting</b><small>Live snapshot</small></span>
      </div>
    </nav>
  );
}
