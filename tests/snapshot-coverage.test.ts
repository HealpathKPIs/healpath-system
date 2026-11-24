import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSnapshotCoverage } from '../lib/snapshot-coverage';

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

test('July request is unavailable when snapshot ends in June', () => {
  assert.equal(evaluateSnapshotCoverage({ month: '2026-07' }, months).status, 'unavailable');
});

test('August request is unavailable when snapshot ends in June', () => {
  assert.equal(evaluateSnapshotCoverage({ month: '2026-08' }, months).status, 'unavailable');
});

test('July with doctor filter is unavailable', () => {
  assert.equal(evaluateSnapshotCoverage({ month: '2026-07', doctor: 'Doctor A' }, months).status, 'unavailable');
});

test('covered June with an unsupported filter is unavailable', () => {
  assert.equal(evaluateSnapshotCoverage({ month: '2026-06', specialty: 'Cardiology' }, months).status, 'unavailable');
});

test('covered June without filters can use the cached snapshot', () => {
  assert.deepEqual(evaluateSnapshotCoverage({ month: '2026-06' }, months), {
    status: 'cached',
    month: '2026-06',
    reason: 'Snapshot contains unfiltered aggregates for 2026-06.',
  });
});

test('open-ended reporting window is unavailable for a partial snapshot', () => {
  assert.equal(evaluateSnapshotCoverage({}, months).status, 'unavailable');
});
