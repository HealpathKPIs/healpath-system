/**
 * A short-lived memo for the expensive dashboard reads.
 *
 * Measured on the live database, the Overview page spent about 4.4 seconds in
 * Postgres per load and did it again on every navigation, because nothing was
 * cached anywhere: the pages are force-dynamic and next.config.js sets
 * staleTimes to zero. The SQL itself has already been cut back about as far as
 * it goes - getKpis now scans visits once instead of six times and getTrends
 * aggregates each fact table once instead of once per month - and the page
 * still took 4.4 seconds, because five queries fired at once into a pool of
 * four connections and the wall time was set by contention rather than by any
 * one query. The work that is left is not to make the queries faster but to
 * stop repeating them.
 *
 * This deliberately follows the pattern already established for the filter
 * enumerations further down lib/queries.ts rather than reaching for
 * unstable_cache, for four reasons:
 *
 *  1. It behaves identically in the RSC runtime, in dev, in the CLI importer and
 *     in tests. unstable_cache needs a request scope, so the importer and the
 *     test suite would have to special-case it - and it could not be measured
 *     from a script.
 *  2. Nothing touches the disk. Next's Data Cache persists to .next/cache, and
 *     a healthcare dashboard should not leave query results lying in a build
 *     directory even when they are aggregates.
 *  3. invalidateDashboardData() already exists and every import route already
 *     calls it, so the invalidation contract is a one-line addition rather than
 *     a new mechanism.
 *  4. The existing enumeration cache solves the same problem the same way, with
 *     the same TTL-plus-generation safety, so there is one idea here, not two.
 *
 * The trade-off is that the memo is per-process: on Vercel each concurrent
 * instance warms its own, and a restart clears it. Cross-instance caching is a
 * separate change, and `unstable_cache` over this same key space is the natural
 * way to add it later.
 *
 * Correctness notes:
 *
 *  - A value is only reused inside its TTL, so an import this process did not
 *    make still surfaces on its own, exactly as the enumeration cache does.
 *  - The generation counter means an invalidation that lands while a read is
 *    already in flight cannot write a pre-import value back into the memo.
 *  - Concurrent callers for the same key share one promise, so a page that asks
 *    four components for the same figure issues one query.
 *  - A rejected read is never cached, and the entry is dropped so the next
 *    caller retries.
 *  - Only a clean live read is kept. The query functions fall back to the
 *    bundled snapshot internally rather than throwing, so a read taken during
 *    an outage returns successfully and used to be memoised like any other -
 *    which meant a snapshot value could be served, with no fallback recorded on
 *    the hits, behind a badge that still said Live. The memo now reads
 *    lib/data-source's outcome markers either side of the call and stores the
 *    result only if the database was actually reached AND nothing degraded. A
 *    degraded read is returned to its caller and then forgotten, so the next
 *    request tries the database again.
 *
 * One contract for callers: a memoised result is SHARED, so treat what comes
 * back as immutable. Sort or splice a copy, never the array you were handed, or
 * the next reader of that entry gets your edit. Every current caller already
 * does this (`[...rows].sort()`, `.slice()`, `.flatMap()`); a new one that does
 * not would corrupt the entry for everybody until its TTL expired.
 */

import { readOutcomeMarker, recordMemoryCacheRead } from './data-source';

/** 60s: long enough to cover somebody clicking between pages, short enough that
 *  any value in here is still recognisably current. */
export const QUERY_TTL_MS = 60_000;

/** Entries are small, but the key space is filter combinations, so it is bounded. */
const MAX_ENTRIES = 240;

interface Entry {
  value: unknown;
  storedAt: number;
  generation: number;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let generation = 0;

/**
 * Key order has to be stable or `{...f, month}` and `{month, ...f}` would be two
 * entries for one question. Objects are serialised with their keys sorted.
 */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableKey(object[key])}`).join(',')}}`;
}

/** Oldest-first eviction. The map preserves insertion order, so this is cheap. */
function evictIfFull(): void {
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}

/**
 * Drop every memoised read. Called from invalidateDashboardData(), so an import
 * is visible on the very next render rather than up to one TTL later.
 */
export function invalidateQueryCache(): void {
  entries.clear();
  inFlight.clear();
  generation += 1;
}

/** How many entries are warm. Exposed for diagnostics and tests, not for pages. */
export function queryCacheSize(): number {
  return entries.size;
}

/**
 * Memoise one read.
 *
 * `name` namespaces the entry and `args` are what the read varies by - pass the
 * same values the wrapped function receives, and nothing else.
 */
export async function memoRead<T>(
  name: string,
  args: unknown[],
  run: () => Promise<T>,
  ttlMs: number = QUERY_TTL_MS,
): Promise<T> {
  const key = `${name}|${stableKey(args)}`;
  const now = Date.now();

  const hit = entries.get(key);
  if (hit && hit.generation === generation && now - hit.storedAt < ttlMs) {
    // Say so. Without this the request looks like it read nothing at all, and
    // classifyDataSource would fall through to 'live' for a request that never
    // touched the database.
    recordMemoryCacheRead(name, `Served from the in-process memo, read ${Math.round((now - hit.storedAt) / 1000)}s ago.`);
    return hit.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const startedAtGeneration = generation;
  const promise = (async () => {
    const before = readOutcomeMarker();
    try {
      const value = await run();
      const after = readOutcomeMarker();
      const reachedDatabase = after.live > before.live;
      const degraded = after.degraded > before.degraded;

      // Three conditions, all required. No invalidation landed while this was
      // in flight; the database was actually read; nothing fell back to the
      // snapshot, failed, or came back uncovered. Anything else is returned to
      // the caller and deliberately not kept.
      if (generation === startedAtGeneration && reachedDatabase && !degraded) {
        evictIfFull();
        entries.set(key, { value, storedAt: Date.now(), generation });
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
