'use client';

// RC-3 Case 3 — database unavailable AND no cached snapshot.
//
// The query layer falls back to the bundled snapshot when a live query fails, so
// this boundary is reached only when there is nothing to fall back to (the
// snapshot is missing/unusable) or a page throws outright. It deliberately
// renders an empty state rather than zeroed KPI cards and blank charts, which
// would look like real "no activity" data.

import { useEffect } from 'react';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[data-source] page render failed with no usable data source', {
      timestamp: new Date().toISOString(),
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <section style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 24 }}>
      <div
        role="alert"
        style={{
          maxWidth: 520, width: '100%', border: '1px solid var(--danger)', borderRadius: 14,
          padding: '28px 26px', background: 'var(--surface)', boxShadow: 'var(--shadow-xs)', display: 'grid', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--danger)', fontWeight: 800, fontSize: 16 }}>
          <span aria-hidden="true">🔴</span> Database unavailable
        </div>
        <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: 14, fontWeight: 600, lineHeight: 1.55 }}>
          No cached data is available either, so this page has nothing to show. No figures are
          displayed rather than risk presenting placeholder numbers as real ones.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 40, borderRadius: 10, border: 0, padding: '0 18px', cursor: 'pointer',
              background: 'linear-gradient(180deg, #1e293b, #0f172a)', color: '#fff', font: 'inherit',
              fontSize: 13.5, fontWeight: 700,
            }}
          >
            Retry
          </button>
          <a
            href="/api/health"
            style={{
              height: 40, display: 'inline-flex', alignItems: 'center', borderRadius: 10,
              border: '1px solid var(--border)', padding: '0 16px', color: 'var(--text)',
              textDecoration: 'none', fontSize: 13.5, fontWeight: 700,
            }}
          >
            Check status
          </a>
        </div>
      </div>
    </section>
  );
}
