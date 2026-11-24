import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { listImportBatches } from '@/lib/import-governance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
  const result = await listImportBatches(Number.isFinite(limit) ? limit : 50);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
