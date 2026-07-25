// RC-3 — the data-source badge every dashboard page carries, plus the degraded
// banner when the page did not render from live data.
//
// This is a server component and MUST be rendered after the page has awaited its
// queries (i.e. from the page header), because that is when the per-request
// tracker in lib/data-source knows whether anything fell back.

import { cache } from 'react';
import { getDataSourceState } from '@/lib/data-source';
import { dbHealthCheck, hasDb } from '@/lib/pg';
import DataSourceBanner from './DataSourceBanner';

// One `select 1` per request, shared by the badge and the banner. This is what
// makes the verdict independent of render order: pages like Chronic Care build
// their header before their Suspense children have run a single query, so the
// per-request failure tracker alone would report "Live" during a total outage.
const probeDatabase = cache(async () => {
  if (!hasDb) return { reachable: false };
  return dbHealthCheck(2500);
});

async function currentState() {
  const probe = await probeDatabase();
  return getDataSourceState(hasDb, probe.reachable);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const TONE = {
  live: { dot: '🟢', label: 'Live', color: 'var(--success)' },
  snapshot: { dot: '🟡', label: 'Cached Snapshot', color: 'var(--warning)' },
  offline: { dot: '🔴', label: 'Offline', color: 'var(--danger)' },
} as const;

/** The small status badge. Sits in the page header next to the title. */
export async function DataSourceBadge() {
  const state = await currentState();
  const tone = TONE[state.status];

  const title =
    state.status === 'live'
      ? `Live data · source: Supabase · read ${formatTimestamp(state.readAt)}`
      : state.status === 'snapshot'
        ? `Cached snapshot ${state.snapshot?.version ?? ''} · generated ${formatTimestamp(state.snapshot?.generatedAt)} · covers ${state.snapshot?.coverage ?? 'unknown'} · data may be outdated`
        : 'Database unavailable and no cached snapshot';

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
        border: `1px solid ${tone.color}`, borderRadius: 999, background: 'var(--surface)',
        color: tone.color, fontSize: 12, fontWeight: 750, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{tone.dot}</span>
      {tone.label}
      {state.status === 'snapshot' && state.snapshot?.generatedAt ? (
        <span style={{ color: 'var(--text-muted)', fontWeight: 650 }}>
          · {formatTimestamp(state.snapshot.generatedAt)}
        </span>
      ) : null}
    </span>
  );
}

/** The retrying banner — renders nothing while the data is live. */
export default async function DataSourceStatus() {
  const state = await currentState();
  if (state.status === 'live') return null;
  return (
    <DataSourceBanner
      status={state.status}
      snapshotGeneratedAt={state.snapshot?.generatedAt ?? null}
      snapshotVersion={state.snapshot?.version ?? null}
      coverage={state.snapshot?.coverage ?? null}
    />
  );
}
