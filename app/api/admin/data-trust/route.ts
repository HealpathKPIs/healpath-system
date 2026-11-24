import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api-auth';
import { getDataTrustReport } from '@/lib/data-trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const report = await getDataTrustReport();
  return NextResponse.json(report, {
    status: report.database.reachable ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
