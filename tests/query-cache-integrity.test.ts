import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyDataSource,
  recordCachedRead,
  recordLiveQuery,
  recordQueryFailure,
  recordUnavailableRead,
} from '../lib/data-source';
import { invalidateQueryCache, memoRead, queryCacheSize } from '../lib/query-cache';

/**
 * The memo must never turn a degraded read into something the dashboard then
 * presents as live. Each test below is one route to that outcome.
 *
 * The reads are simulated the way the real query functions behave: a successful
 * one reports a live query (dbQuery does this), and a degraded one reports a
 * fallback and returns snapshot-shaped data instead of throwing.
 */

const liveRead = (value: string) => async () => {
  recordLiveQuery();
  return value;
};

const snapshotFallbackRead = (value: string) => async () => {
  recordQueryFailure('test', new Error('connection refused'));
  recordCachedRead('test', 'Bundled snapshot is being used.');
  return value;
};

// --- 1. successful database read, then a cache hit ---------------------------

test('a successful database read is cached and the next caller gets the hit', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    recordLiveQuery();
    return 'live value';
  };

  assert.equal(await memoRead('ok', [{}], run), 'live value');
  assert.equal(await memoRead('ok', [{}], run), 'live value');
  assert.equal(calls, 1, 'the second read should have been served from the memo');
  assert.equal(queryCacheSize(), 1);
});

// --- 2. snapshot fallback is never cached ------------------------------------

test('a snapshot fallback is returned but never cached', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    return snapshotFallbackRead(`snapshot ${calls}`)();
  };

  assert.equal(await memoRead('fallback', [{}], run), 'snapshot 1');
  assert.equal(queryCacheSize(), 0, 'a snapshot-backed result must not be stored');

  // The next request must try the database again rather than be handed the
  // snapshot value behind a Live badge.
  assert.equal(await memoRead('fallback', [{}], run), 'snapshot 2');
  assert.equal(calls, 2);
});

test('an uncovered read is never cached either', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    recordUnavailableRead('test', 'Snapshot cannot reproduce the requested filter.');
    return 'empty';
  };

  await memoRead('uncovered', [{}], run);
  await memoRead('uncovered', [{}], run);
  assert.equal(calls, 2);
  assert.equal(queryCacheSize(), 0);
});

test('a read that never touched the database is not cached', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    return 'computed without a query';
  };

  await memoRead('noquery', [{}], run);
  await memoRead('noquery', [{}], run);
  assert.equal(calls, 2, 'only a read that actually reached the database may be kept');
  assert.equal(queryCacheSize(), 0);
});

// --- 3. a thrown read is not cached ------------------------------------------

test('a failed read is not cached and does not wipe what is already warm', async () => {
  invalidateQueryCache();
  await memoRead('warm', [{}], liveRead('kept'));
  assert.equal(queryCacheSize(), 1);

  await assert.rejects(
    () =>
      memoRead('broken', [{}], async () => {
        recordQueryFailure('test', new Error('timeout'));
        throw new Error('timeout');
      }),
    /timeout/,
  );

  assert.equal(queryCacheSize(), 1, 'an unrelated failure must not drop good entries');
  assert.equal(await memoRead('warm', [{}], liveRead('should not run')), 'kept');
});

// --- 4. an outage with a warm memo must not read as Live ---------------------

test('a database outage reports unavailable even with a warm memo', () => {
  assert.equal(
    classifyDataSource({
      hasDb: true,
      databaseReachable: false,
      liveQueries: 0,
      failureCount: 0,
      cachedReadCount: 0,
      unavailableReadCount: 0,
      memoryCacheReadCount: 4, // every figure on the page came from the memo
    }),
    'unavailable',
  );
});

test('a memo hit never satisfies the "cached data exists" escape', () => {
  // Without a snapshot read, a down database is unavailable whatever the memo
  // holds. This is the specific hole the fix closes.
  for (const memoryCacheReadCount of [0, 1, 9]) {
    assert.equal(
      classifyDataSource({
        hasDb: false,
        databaseReachable: false,
        liveQueries: 0,
        failureCount: 0,
        cachedReadCount: 0,
        unavailableReadCount: 0,
        memoryCacheReadCount,
      }),
      'unavailable',
    );
  }
});

test('a page served wholly from the memo is cached, not live', () => {
  assert.equal(
    classifyDataSource({
      hasDb: true,
      databaseReachable: true,
      liveQueries: 0,
      failureCount: 0,
      cachedReadCount: 0,
      unavailableReadCount: 0,
      memoryCacheReadCount: 3,
    }),
    'cached',
  );
});

test('a snapshot read still outranks a memo hit', () => {
  assert.equal(
    classifyDataSource({
      hasDb: true,
      databaseReachable: true,
      liveQueries: 0,
      failureCount: 0,
      cachedReadCount: 1,
      unavailableReadCount: 0,
      memoryCacheReadCount: 3,
    }),
    'snapshot',
  );
});

test('the existing verdicts are unchanged when no memo is involved', () => {
  const base = { hasDb: true, databaseReachable: true, unavailableReadCount: 0 };
  assert.equal(classifyDataSource({ ...base, liveQueries: 4, failureCount: 0, cachedReadCount: 0 }), 'live');
  assert.equal(classifyDataSource({ ...base, liveQueries: 4, failureCount: 1, cachedReadCount: 1 }), 'mixed');
  assert.equal(classifyDataSource({ ...base, liveQueries: 0, failureCount: 1, cachedReadCount: 1 }), 'snapshot');
  assert.equal(classifyDataSource({ ...base, liveQueries: 4, failureCount: 1, cachedReadCount: 0 }), 'unavailable');
});

// --- 5. recovery -------------------------------------------------------------

test('once the database recovers, reads are cached again', async () => {
  invalidateQueryCache();
  let calls = 0;

  // Outage: nothing is retained.
  await memoRead('recovery', [{}], snapshotFallbackRead('snapshot'));
  assert.equal(queryCacheSize(), 0);

  // Recovered: the first clean read is kept, the next caller gets it.
  const healthy = async () => {
    calls++;
    recordLiveQuery();
    return 'live again';
  };
  assert.equal(await memoRead('recovery', [{}], healthy), 'live again');
  assert.equal(queryCacheSize(), 1);
  assert.equal(await memoRead('recovery', [{}], healthy), 'live again');
  assert.equal(calls, 1);
});

// --- 6 & 7. import invalidation ----------------------------------------------

test('a successful import drops the memo', async () => {
  invalidateQueryCache();
  await memoRead('import', [{}], liveRead('pre-import'));
  assert.equal(queryCacheSize(), 1);

  const { invalidateDashboardData } = await import('../lib/data-refresh');
  invalidateDashboardData(); // what every import route calls on commit

  assert.equal(queryCacheSize(), 0);
  assert.equal(await memoRead('import', [{}], liveRead('post-import')), 'post-import');
});

test('a failed read does not invalidate anything on its own', async () => {
  invalidateQueryCache();
  await memoRead('a', [{}], liveRead('a value'));
  await memoRead('b', [{}], liveRead('b value'));
  assert.equal(queryCacheSize(), 2);

  // A read that fails mid-import, or any degraded read, must not behave like a
  // successful import and clear everybody else's entries.
  await memoRead('c', [{}], snapshotFallbackRead('fallback'));
  assert.equal(queryCacheSize(), 2, 'a degraded read must not invalidate the memo');
  assert.equal(await memoRead('a', [{}], liveRead('should not run')), 'a value');
});

test('every import route still calls the single invalidation entry point', () => {
  const routes = [
    'app/api/admin/import/route.ts',
    'app/api/admin/patient-master/route.ts',
    'app/api/capacity/import/route.ts',
    'app/api/chronic/import/route.ts',
  ];
  for (const route of routes) {
    const source = readFileSync(route, 'utf8');
    assert.match(source, /invalidateDashboardData\(\)/, `${route} must invalidate after it commits`);
  }
});

// --- 8. concurrency ----------------------------------------------------------

test('concurrent degraded reads share one call and none of them is cached', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return snapshotFallbackRead('snapshot')();
  };

  const all = await Promise.all([
    memoRead('concurrent', [{}], run),
    memoRead('concurrent', [{}], run),
    memoRead('concurrent', [{}], run),
  ]);

  assert.deepEqual(all, ['snapshot', 'snapshot', 'snapshot']);
  assert.equal(calls, 1);
  assert.equal(queryCacheSize(), 0);
});

test('an import landing mid-read discards that read even when it was clean', async () => {
  invalidateQueryCache();
  const run = async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    recordLiveQuery();
    return 'pre-import value';
  };

  const inFlight = memoRead('race', [{}], run);
  await new Promise((resolve) => setTimeout(resolve, 5));
  invalidateQueryCache();

  assert.equal(await inFlight, 'pre-import value');
  assert.equal(queryCacheSize(), 0, 'a value read before the import must not be kept after it');
});
