import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { getImportBatch, recordObservation } from '@/lib/import-governance';
import { captureAcuteReconciliation, reconcileAcute } from '@/lib/import-reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Records an aggregate after-state only. It does not infer row-level importer outcomes. */
export async function POST(_request: Request, context: { params: { id: string } }) {
  const authError = await requireAdminApi();
  if (authError) return authError;
  const batch = await getImportBatch(context.params.id);
  if (!batch || !batch.beforeState) return NextResponse.json({ error: 'Import batch or before-state not found.' }, { status: 404 });
  const afterState = await captureAcuteReconciliation();
  const result = reconcileAcute(batch.beforeState, afterState);
  await recordObservation({ batchId: batch.id, afterState, result });
  return NextResponse.json({ batchId: batch.id, importerOutcome: 'UNKNOWN', afterState, result, dataVersionCreated: false }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
