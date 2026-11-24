// RC-3 — lightweight health check. Lets the dashboard tell live / cached /
// offline apart without waiting for a page's queries to fail, and gives the
// degraded-state banner something cheap to poll while it retries.

import { NextResponse } from 'next/server';
import { dbHealthCheck, hasDb } from '@/lib/pg';
import { snapshotAvailable, snapshotMeta, type DataSourceStatus } from '@/lib/data-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await dbHealthCheck();
  const haveSnapshot = snapshotAvailable();

  const status: DataSourceStatus = database.reachable
    ? 'live'
    : haveSnapshot
      ? 'snapshot'
      : 'unavailable';
  const meta = snapshotMeta();
  const generatedAtMs = meta?.generatedAt ? Date.parse(meta.generatedAt) : Number.NaN;
  const snapshotAgeDays = Number.isFinite(generatedAtMs)
    ? Number(((Date.now() - generatedAtMs) / 86_400_000).toFixed(1))
    : null;

  if (!database.reachable) {
    console.error(
      '[data-source] health check failed',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        configured: hasDb,
        reason: database.error ?? 'unknown',
        fallback: haveSnapshot ? 'snapshot' : 'none',
        snapshotVersion: snapshotMeta()?.version ?? null,
      }),
    );
  }

  return NextResponse.json(
    {
      status,
      checkedAt: new Date().toISOString(),
      database: {
        configured: hasDb,
        reachable: database.reachable,
        latencyMs: database.latencyMs,
        ...(database.error ? { error: database.error } : {}),
      },
      source: database.reachable ? 'LIVE' : haveSnapshot ? 'CACHED_AVAILABLE' : 'UNAVAILABLE',
      operationalStatus: database.reachable ? 'HEALTHY' : haveSnapshot ? 'DEGRADED' : 'UNAVAILABLE',
      snapshot: haveSnapshot ? { ...meta, ageDays: snapshotAgeDays, exactRequestSupport: 'unknown-until-requested' } : null,
    },
    // Never cache a health verdict.
    { headers: { 'Cache-Control': 'no-store, max-age=0' }, status: status === 'unavailable' ? 503 : 200 },
  );
}
