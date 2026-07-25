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
      : 'offline';

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
      snapshot: haveSnapshot ? snapshotMeta() : null,
    },
    // Never cache a health verdict.
    { headers: { 'Cache-Control': 'no-store, max-age=0' }, status: status === 'offline' ? 503 : 200 },
  );
}
