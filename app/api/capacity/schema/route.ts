import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { capacitySchemaStatus, getCapacityPool } from '@/lib/capacity/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Install and report the capacity schema.
 *
 * The repository has no migration runner, so a migration file nobody can apply
 * is worse than no migration at all. This applies the reviewed file in one
 * transaction, which keeps the schema itself diffable — the point being that
 * "no patient column exists in capacity" is a claim you can check by reading
 * one file rather than by tracing code.
 */

const MIGRATION = '20261027000100_capacity.sql';

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    return NextResponse.json(await capacitySchemaStatus());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  let sql: string;
  try {
    sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
  } catch {
    return NextResponse.json(
      { error: `Could not read ${MIGRATION}. Check outputFileTracingIncludes in next.config.js.` },
      { status: 500 },
    );
  }

  const client = await getCapacityPool().connect();
  try {
    // The file carries its own begin/commit, so it runs as one unit.
    await client.query(sql);
    const status = await capacitySchemaStatus();
    return NextResponse.json({ applied: true, migration: MIGRATION, ...status });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message, migration: MIGRATION }, { status: 500 });
  } finally {
    client.release();
  }
}
