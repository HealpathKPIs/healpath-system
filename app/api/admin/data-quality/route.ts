import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { getDataQualityReport } from '@/lib/data-quality-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const report = await getDataQualityReport();
  return NextResponse.json(report, {
    status: report.source.source === 'UNAVAILABLE' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
}
