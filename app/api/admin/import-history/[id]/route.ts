import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { getImportBatch } from '@/lib/import-governance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { id: string } }) {
  const authError = await requireAdminApi();
  if (authError) return authError;
  const batch = await getImportBatch(context.params.id);
  if (!batch) return NextResponse.json({ error: 'Import batch not found or audit tables are unavailable.' }, { status: 404 });
  return NextResponse.json(batch, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
