// RC-3 — data-source awareness.
//
// Every query in the metric layer is wrapped in `try { live } catch { snapshot }`.
// That made a database outage invisible: the dashboard kept rendering the bundled
// snapshot2026.json, which holds 2026-01..2026-06 — it invents a January that is
// not in the database and hides July — with no logging and no visual difference.
// For an executive dashboard that is the worst possible failure mode: wrong
// numbers that look right.
//
// The fallback still exists (a degraded dashboard beats a blank one), but it is
// now recorded, logged with the exception, and surfaced in the UI. Every page
// carries a badge saying whether it is showing live data, a cached snapshot, or
// nothing at all.
//
// The tracker is per-request: dbQuery reports each success/failure, and the page
// reads the verdict when it renders its header — by which point all of that
// page's queries have already settled.

import { cache } from 'react';
import snapshot from '../data/snapshot2026.json';

export type DataSourceStatus = 'live' | 'snapshot' | 'offline';

export interface SnapshotMeta {
  version: string;
  generatedAt: string | null;
  sourceDatabase: string | null;
  /** null for the bundled snapshot, which predates import-batch tracking. */
  importBatch: string | null;
  /** Month range the snapshot covers, e.g. "2026-01..2026-06". */
  coverage: string | null;
  recordCounts: Record<string, number>;
}

export interface QueryFailure {
  at: string;
  context: string;
  message: string;
}

interface RequestDataSource {
  liveQueries: number;
  failures: QueryFailure[];
}

// React's cache() scopes this to a single request/render pass. Outside a render
// (route handlers, scripts) it can throw, so callers get a throwaway store —
// logging still happens, only the per-request roll-up is skipped.
const requestStore = cache((): RequestDataSource => ({ liveQueries: 0, failures: [] }));

function store(): RequestDataSource {
  try {
    return requestStore();
  } catch {
    return { liveQueries: 0, failures: [] };
  }
}

export function snapshotMeta(): SnapshotMeta | null {
  const meta = (snapshot as { meta?: SnapshotMeta }).meta;
  return meta ?? null;
}

/** The bundled snapshot is only usable if it actually carries data. */
export function snapshotAvailable(): boolean {
  return Array.isArray((snapshot as { months?: unknown[] }).months) && (snapshot as { months: unknown[] }).months.length > 0;
}

export function recordLiveQuery(): void {
  store().liveQueries += 1;
}

/**
 * Record — and always log — a failed database query. Never swallow the
 * exception: this is the single place that knows a fallback is about to happen.
 */
export function recordQueryFailure(context: string, error: unknown): void {
  const failure: QueryFailure = {
    at: new Date().toISOString(),
    context,
    message: error instanceof Error ? error.message : String(error),
  };
  store().failures.push(failure);

  const meta = snapshotMeta();
  console.error(
    '[data-source] live query failed, falling back to snapshot',
    JSON.stringify({
      timestamp: failure.at,
      context: failure.context,
      reason: failure.message,
      snapshotVersion: meta?.version ?? null,
      snapshotGeneratedAt: meta?.generatedAt ?? null,
      fallback: snapshotAvailable() ? 'snapshot' : 'none',
    }),
    error instanceof Error ? error.stack : undefined,
  );
}

export interface DataSourceState {
  status: DataSourceStatus;
  /** When this page read its data. */
  readAt: string;
  failures: QueryFailure[];
  snapshot: SnapshotMeta | null;
}

/**
 * What this request is actually showing.
 *
 * Two independent signals, because neither alone is trustworthy:
 *
 *  - `failures` — queries this request already ran and lost. Precise, but only
 *    populated for pages that await their data BEFORE rendering the header.
 *    Chronic Care renders its header first and streams data in via Suspense, so
 *    on its own this signal reported "Live" during a full outage.
 *  - `databaseReachable` — a direct `select 1` taken while rendering the badge.
 *    Independent of render order, so it catches exactly that case.
 *
 * Either one saying "not live" wins. The dashboard may understate its health,
 * but it must never claim data is live when it is not.
 */
export function getDataSourceState(hasDb: boolean, databaseReachable?: boolean): DataSourceState {
  const { failures } = store();
  const haveSnapshot = snapshotAvailable();
  const degraded = !hasDb || failures.length > 0 || databaseReachable === false;

  const status: DataSourceStatus = !degraded
    ? 'live'
    : haveSnapshot
      ? 'snapshot'
      : 'offline';

  return { status, readAt: new Date().toISOString(), failures, snapshot: snapshotMeta() };
}
