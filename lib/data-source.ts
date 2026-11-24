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

/**
 * 'cached' is the in-process memo in lib/query-cache: data that WAS read live,
 * at most one TTL ago, dropped the moment an import commits. It is deliberately
 * not 'live' (this request did not touch the database) and deliberately not
 * 'snapshot' (the bundled snapshot2026.json is a different and much older
 * thing, and conflating them would make a healthy page look degraded).
 */
export type DataSourceStatus = 'live' | 'cached' | 'snapshot' | 'mixed' | 'unavailable';
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
  /**
   * Memo hits, kept apart from `cachedReads` on purpose. A snapshot read means
   * the database could not answer; a memo hit means it already did. Counting
   * them together would both paint a healthy page as a degraded snapshot AND
   * let a memo hit satisfy the "cached data exists" escape in
   * classifyDataSource, which is exactly how an outage could show Live.
   */
  memoryCacheReads: CachedRead[];
}

// React's cache() scopes this to a single request/render pass. It only exists
// inside the RSC runtime: plain Node (the CLI importer, scripts, tests) imports
// this module transitively via lib/pg.ts, where `cache` is undefined. So it is
// resolved lazily and defensively — outside a render each caller just gets a
// throwaway store, and logging still happens; only the per-request roll-up is
// skipped. Building it at module scope instead crashes the importer on load.
const fresh = (): RequestDataSource => ({ liveQueries: 0, failures: [], cachedReads: [], unavailableReads: [], memoryCacheReads: [] });

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

/**
 * Process-wide outcome markers, deliberately NOT request-scoped.
 *
 * lib/query-cache has to decide whether the read it just awaited actually
 * reached the database or quietly fell back to the snapshot, and it has to be
 * able to decide that in the RSC runtime, in the CLI importer and in tests
 * alike. The per-request store cannot answer that: outside a render, store()
 * hands every caller a throwaway object, so nothing accumulates.
 *
 * These two counters only ever increase, and the memo reads them either side of
 * the call. Under concurrency another request's degradation can land between
 * the two reads, in which case the memo declines to cache a result it could
 * have kept. That is the safe direction to be wrong in: a missed cache entry
 * costs one query, a cached snapshot costs wrong numbers.
 */
let liveReadMarker = 0;
let degradedReadMarker = 0;

export interface ReadOutcomeMarker {
  live: number;
  degraded: number;
}

export function readOutcomeMarker(): ReadOutcomeMarker {
  return { live: liveReadMarker, degraded: degradedReadMarker };
}

export function recordLiveQuery(): void {
  store().liveQueries += 1;
  liveReadMarker += 1;
}

/**
 * A read served from the in-process memo. Not a degradation: the value came
 * from the database, within one TTL, and an import drops it.
 */
export function recordMemoryCacheRead(context: string, detail: string): void {
  store().memoryCacheReads.push({ at: new Date().toISOString(), context, source: 'memory-cache', detail });
}

export function recordCachedRead(
  context: string,
  detail: string,
  source: CachedRead['source'] = 'bundled-snapshot',
): void {
  store().cachedReads.push({ at: new Date().toISOString(), context, source, detail });
  degradedReadMarker += 1;
}

export function recordUnavailableRead(context: string, reason: string): void {
  const entry = { at: new Date().toISOString(), context, reason };
  store().unavailableReads.push(entry);
  degradedReadMarker += 1;
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
  degradedReadMarker += 1;

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
  source: 'LIVE' | 'LIVE (CACHED)' | 'CACHED' | 'MIXED' | 'UNAVAILABLE';
  /** When this page read its data. */
  readAt: string;
  failures: QueryFailure[];
  cachedReads: CachedRead[];
  unavailableReads: UnavailableRead[];
  memoryCacheReads: CachedRead[];
  snapshot: SnapshotMeta | null;
}

export function classifyDataSource(signals: {
  hasDb: boolean;
  databaseReachable?: boolean;
  liveQueries: number;
  failureCount: number;
  cachedReadCount: number;
  unavailableReadCount: number;
  /**
   * Reads served from the in-process memo. Optional so existing callers and
   * tests keep their meaning; absent is treated as zero.
   */
  memoryCacheReadCount?: number;
}): DataSourceStatus {
  const databaseDown = !signals.hasDb || signals.databaseReachable === false;
  // Memo hits are intentionally absent from this first condition. A warm memo
  // during an outage must still report 'unavailable': the page is showing data
  // the database cannot currently confirm, and saying anything softer than that
  // is the failure mode this whole module exists to prevent.
  if (signals.unavailableReadCount > 0 || (databaseDown && signals.cachedReadCount === 0)) return 'unavailable';
  if (signals.cachedReadCount > 0 && signals.liveQueries > 0) return 'mixed';
  if (signals.cachedReadCount > 0) return 'snapshot';
  if (signals.failureCount > 0) return 'unavailable';
  // Nothing degraded, the database is reachable, and this request answered
  // entirely from the memo without reading it. That is not a lie-worthy 'live'.
  if ((signals.memoryCacheReadCount ?? 0) > 0 && signals.liveQueries === 0) return 'cached';
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
  const { liveQueries, failures, cachedReads, unavailableReads, memoryCacheReads } = store();
  const status = classifyDataSource({
    hasDb,
    databaseReachable,
    liveQueries,
    failureCount: failures.length,
    cachedReadCount: cachedReads.length,
    unavailableReadCount: unavailableReads.length,
    memoryCacheReadCount: memoryCacheReads.length,
  });

  // 'cached' is healthy: the numbers came from the database, the database is
  // reachable right now, and nothing fell back. Only its age is different.
  const operationalStatus: OperationalStatus = status === 'live' || status === 'cached'
    ? 'healthy'
    : status === 'unavailable'
      ? 'unavailable'
      : 'degraded';
  const source = status === 'live'
    ? 'LIVE'
    : status === 'cached'
      ? 'LIVE (CACHED)'
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
    memoryCacheReads,
    snapshot: snapshotMeta(),
  };
}
