import { NextResponse } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { getCurrentProfile } from '@/lib/auth-server';
import { createObservationBatch, findBatchByHash } from '@/lib/import-governance';
import { fingerprintBuffer } from '@/lib/import-fingerprint';
import { captureAcuteReconciliation } from '@/lib/import-reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Governance-only preview. It fingerprints and observes; it never invokes the trusted importer. */
export async function POST(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
  const fingerprint = fingerprintBuffer(Buffer.from(await file.arrayBuffer()), file.name);
  const duplicate = await findBatchByHash(fingerprint.fileHash);
  const beforeState = await captureAcuteReconciliation();
  const batch = await createObservationBatch({
    importType: String(form.get('importType') ?? 'ACUTE'),
    fileName: fingerprint.fileName,
    fileHash: fingerprint.fileHash,
    fileSizeBytes: fingerprint.fileSizeBytes,
    initiatedBy: profile.email,
    initiatedByUserId: profile.id,
    source: 'governance-observation',
    beforeState,
    duplicateOfBatchId: duplicate?.id ?? null,
  });
  return NextResponse.json({ batch, fingerprint, duplicate: Boolean(duplicate), importerInvoked: false }, { status: 201 });
}
