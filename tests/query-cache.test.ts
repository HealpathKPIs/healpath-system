import test from 'node:test';
import assert from 'node:assert/strict';

import { recordLiveQuery } from '../lib/data-source';
import {
  QUERY_TTL_MS,
  invalidateQueryCache,
  memoRead,
  queryCacheSize,
} from '../lib/query-cache';

/**
 * The memo sits in front of every expensive dashboard read, so the ways it can
 * be wrong are the ways the dashboard can start showing yesterday's numbers.
 * Each test below is one of them.
 *
 * Only a read that actually reached the database is eligible to be cached, so
 * every simulated success here reports a live query the way dbQuery does. A
 * `run` that reports nothing is not a database read and is deliberately never
 * stored - tests/query-cache-integrity.test.ts covers that rule and the
 * degraded cases directly.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A successful database read. */
const dbRead = <T>(produce: () => T) => async () => {
  recordLiveQuery();
  return produce();
};

test('a second read inside the TTL does not go to the database', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = dbRead(() => {
    calls++;
    return 'value';
  });

  assert.equal(await memoRead('t1', [{ month: null }], run), 'value');
  assert.equal(await memoRead('t1', [{ month: null }], run), 'value');
  assert.equal(calls, 1);
});

test('a read past its TTL goes again, so an import elsewhere still surfaces', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = dbRead(() => `call ${++calls}`);

  assert.equal(await memoRead('t2', [], run, 20), 'call 1');
  assert.equal(await memoRead('t2', [], run, 20), 'call 1', 'still inside the TTL');
  await sleep(35);
  assert.equal(await memoRead('t2', [], run, 20), 'call 2');
  assert.equal(calls, 2);
});

test('invalidation drops everything, so an import shows on the next render', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = dbRead(() => `call ${++calls}`);

  await memoRead('t3', [], run);
  assert.equal(queryCacheSize(), 1);

  invalidateQueryCache();
  assert.equal(queryCacheSize(), 0);
  assert.equal(await memoRead('t3', [], run), 'call 2');
});

test('concurrent callers for one key share a single query', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    await sleep(15);
    recordLiveQuery();
    return 'shared';
  };

  const all = await Promise.all([
    memoRead('t4', [], run),
    memoRead('t4', [], run),
    memoRead('t4', [], run),
    memoRead('t4', [], run),
  ]);

  assert.deepEqual(all, ['shared', 'shared', 'shared', 'shared']);
  assert.equal(calls, 1);
});

test('an import that lands mid-read cannot write the pre-import value back', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    await sleep(25);
    recordLiveQuery();
    return `call ${calls}`;
  };

  const inFlight = memoRead('t5', [], run);
  await sleep(5);
  invalidateQueryCache(); // the import commits while the read is still running
  assert.equal(await inFlight, 'call 1'); // the caller still gets its answer
  assert.equal(queryCacheSize(), 0); // but it was not kept

  assert.equal(await memoRead('t5', [], run), 'call 2');
});

test('a failed read is never cached', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = async () => {
    calls++;
    throw new Error('database gone');
  };

  await assert.rejects(() => memoRead('t6', [], run), /database gone/);
  assert.equal(queryCacheSize(), 0);
  await assert.rejects(() => memoRead('t6', [], run), /database gone/);
  assert.equal(calls, 2);
});

test('key order does not matter, so one question is one entry', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = dbRead(() => `call ${++calls}`);

  await memoRead('t7', [{ month: '2026-10', doctor: null }], run);
  await memoRead('t7', [{ doctor: null, month: '2026-10' }], run);
  assert.equal(calls, 1);
  assert.equal(queryCacheSize(), 1);
});

test('different filters are different entries', async () => {
  invalidateQueryCache();
  let calls = 0;
  const run = dbRead(() => `call ${++calls}`);

  await memoRead('t8', [{ month: '2026-10' }], run);
  await memoRead('t8', [{ month: '2026-11' }], run);
  await memoRead('t8', [{ month: null }], run);
  assert.equal(calls, 3);
  assert.equal(queryCacheSize(), 3);
});

test('the same filters under different names never collide', async () => {
  invalidateQueryCache();
  const kpis = dbRead(() => 'kpis');
  const trends = dbRead(() => 'trends');

  assert.equal(await memoRead('getKpis', [{}], kpis), 'kpis');
  assert.equal(await memoRead('getTrends', [{}], trends), 'trends');
  assert.equal(queryCacheSize(), 2);
});

test('the entry count stays bounded as filter combinations pile up', async () => {
  invalidateQueryCache();
  const run = dbRead(() => 'value');
  for (let i = 0; i < 400; i++) await memoRead('t9', [{ i }], run);
  assert.ok(queryCacheSize() <= 240, `expected a bounded cache, got ${queryCacheSize()}`);
  assert.ok(queryCacheSize() > 0, 'successful reads should actually be cached');
});

test('the default TTL is short enough that nothing in here goes stale unnoticed', () => {
  // Degraded reads are no longer cached at all, so the TTL now only bounds how
  // old a *good* value can be. A minute keeps it recognisably current between
  // the fifteen-second filter enumerations and the next import.
  assert.ok(QUERY_TTL_MS <= 60_000, 'TTL must stay at a minute or less');
});
