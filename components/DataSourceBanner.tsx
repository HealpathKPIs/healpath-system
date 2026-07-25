'use client';

// RC-3 — the degraded-state banner. Rendered only when the page it sits on did
// NOT come from the live database, and it stays on screen until live data is
// restored: it polls /api/health on a 5s → 10s → 30s → 60s backoff and, the
// moment the database answers again, refreshes the route so the page re-renders
// from live data and the banner disappears on its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const BACKOFF_SECONDS = [5, 10, 30, 60];

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default function DataSourceBanner({
  status,
  snapshotGeneratedAt,
  snapshotVersion,
  coverage,
}: {
  status: 'snapshot' | 'offline';
  snapshotGeneratedAt?: string | null;
  snapshotVersion?: string | null;
  coverage?: string | null;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [countdown, setCountdown] = useState(BACKOFF_SECONDS[0]);
  const [checking, setChecking] = useState(false);
  const recovered = useRef(false);

  const check = useCallback(async () => {
    if (recovered.current) return;
    setChecking(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (data?.status === 'live') {
        recovered.current = true;
        // Live again: re-render this route from the database. The banner is
        // server-driven, so a successful refresh removes it.
        router.refresh();
        return;
      }
    } catch {
      /* still down — the backoff below handles the next attempt */
    } finally {
      setChecking(false);
    }
    setAttempt((n) => n + 1);
  }, [router]);

  // Backoff timer: count down, then check.
  useEffect(() => {
    if (recovered.current) return;
    const wait = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    setCountdown(wait);
    const tick = setInterval(() => setCountdown((n) => (n > 0 ? n - 1 : 0)), 1000);
    const timer = setTimeout(() => { void check(); }, wait * 1000);
    return () => { clearInterval(tick); clearTimeout(timer); };
  }, [attempt, check]);

  const offline = status === 'offline';
  const tone = offline ? 'var(--danger)' : 'var(--warning)';

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        border: `1px solid ${tone}`,
        borderLeft: `4px solid ${tone}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 18,
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-xs)',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: tone, fontWeight: 800, fontSize: 14 }}>
        <span aria-hidden="true">{offline ? '🔴' : '🟡'}</span>
        Database temporarily unavailable.
      </div>

      <div style={{ color: 'var(--text-soft)', fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }}>
        {offline ? (
          <>Unable to load live dashboard data, and no cached snapshot is available.</>
        ) : (
          <>
            Unable to load live dashboard data. <b>Viewing cached snapshot.</b>
            <br />
            Snapshot date: <b>{formatTimestamp(snapshotGeneratedAt)}</b>
            {snapshotVersion ? <> · version <b>{snapshotVersion}</b></> : null}
            {coverage ? <> · covers <b>{coverage}</b></> : null}
            <br />
            Data is read-only and may be outdated.
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
          {checking ? 'Retrying…' : `Retrying in ${countdown}s`}
        </span>
        <button
          type="button"
          onClick={() => { void check(); }}
          disabled={checking}
          style={{
            height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text)', font: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '0 12px',
            cursor: checking ? 'default' : 'pointer',
          }}
        >
          Retry now
        </button>
      </div>
    </div>
  );
}
