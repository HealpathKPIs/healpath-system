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

export type DataSourceStatus = 'live' | 'snapshot' | 'mixed' | 'unavailable';
export type OperationalStatus = 'healthy' | 'degraded' | 'unavailable';

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

export interface CachedRead {
  at: string;
  context: string;
  source: 'bundled-snapshot' | 'memory-cache';
  detail: string;
}

export interface UnavailableRead {
  at: string;
  context: string;
  reason: string;
}

interface RequestDataSource {
  liveQueries: number;
  failures: QueryFailure[];
  cachedReads: CachedRead[];
  unavailableReads: UnavailableRead[];
}

// React's cache() scopes this to a single request/render pass. It only exists
// inside the RSC runtime: plain Node (the CLI importer, scripts, tests) imports
// this module transitively via lib/pg.ts, where `cache` is undefined. So it is
// resolved lazily and defensively — outside a render each caller just gets a
// throwaway store, and logging still happens; only the per-request roll-up is
// skipped. Building it at module scope instead crashes the importer on load.
const fresh = (): RequestDataSource => ({ liveQueries: 0, failures: [], cachedReads: [], unavailableReads: [] });

let requestStore: (() => RequestDataSource) | null = null;

function store(): RequestDataSource {
  try {
    if (!requestStore) {
      requestStore = typeof cache === 'function' ? cache(fresh) : fresh;
    }
    return requestStore();
  } catch {
    return fresh();
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


export function recordCachedRead(
  context: string,
  detail: string,
  source: CachedRead['source'] = 'bundled-snapshot',
): void {
  store().cachedReads.push({ at: new Date().toISOString(), context, source, detail });
}

export function recordUnavailableRead(context: string, reason: string): void {
  const entry = { at: new Date().toISOString(), context, reason };
  store().unavailableReads.push(entry);
  console.error('[data-source] requested view unavailable', JSON.stringify(entry));
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
  operationalStatus: OperationalStatus;
  source: 'LIVE' | 'CACHED' | 'MIXED' | 'UNAVAILABLE';
  /** When this page read its data. */
  readAt: string;
  failures: QueryFailure[];
  cachedReads: CachedRead[];
  unavailableReads: UnavailableRead[];
  snapshot: SnapshotMeta | null;
}

export function classifyDataSource(signals: {
  hasDb: boolean;
  databaseReachable?: boolean;
  liveQueries: number;
  failureCount: number;
  cachedReadCount: number;
  unavailableReadCount: number;
}): DataSourceStatus {
  const databaseDown = !signals.hasDb || signals.databaseReachable === false;
  if (signals.unavailableReadCount > 0 || (databaseDown && signals.cachedReadCount === 0)) return 'unavailable';
  if (signals.cachedReadCount > 0 && signals.liveQueries > 0) return 'mixed';
  if (signals.cachedReadCount > 0) return 'snapshot';
  if (signals.failureCount > 0) return 'unavailable';
  return 'live';
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
  const { liveQueries, failures, cachedReads, unavailableReads } = store();
  const status = classifyDataSource({
    hasDb,
    databaseReachable,
    liveQueries,
    failureCount: failures.length,
    cachedReadCount: cachedReads.length,
    unavailableReadCount: unavailableReads.length,
  });

  const operationalStatus: OperationalStatus = status === 'live'
    ? 'healthy'
    : status === 'unavailable'
      ? 'unavailable'
      : 'degraded';
  const source = status === 'live'
    ? 'LIVE'
    : status === 'snapshot'
      ? 'CACHED'
      : status === 'mixed'
        ? 'MIXED'
        : 'UNAVAILABLE';

  return {
    status,
    operationalStatus,
    source,
    readAt: new Date().toISOString(),
    failures,
    cachedReads,
    unavailableReads,
    snapshot: snapshotMeta(),
  };
}
