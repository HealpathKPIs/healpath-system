import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import {
  CapacityStorageError,
  MAX_UPLOAD_BYTES,
  assertObjectKey,
  createSignedUpload,
  removeObjects,
} from '@/lib/capacity/storage';
import type { CapacityImportKind } from '@/lib/capacity/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: CapacityImportKind[] = ['schedule', 'appointments'];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Mint a signed URL so the browser can upload straight to storage. */
export async function POST(req: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  let body: { kind?: string; fileName?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return badRequest('Expected a JSON body.');
  }

  const kind = body.kind as CapacityImportKind;
  if (!KINDS.includes(kind)) return badRequest('Unknown upload kind.');

  const fileName = String(body.fileName ?? '').trim();
  if (!fileName) return badRequest('A file name is required.');
  if (!/\.xlsx?$/i.test(fileName)) return badRequest('Only .xlsx and .xls workbooks can be imported.');

  const fileSize = Number(body.fileSize ?? 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) return badRequest('That file appears to be empty.');
  if (fileSize > MAX_UPLOAD_BYTES) {
    return badRequest(`That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit.`);
  }

  try {
    const upload = await createSignedUpload(kind);
    return NextResponse.json({ ...upload, expiresInSeconds: 7200 });
  } catch (error) {
    if (error instanceof CapacityStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** Discard an upload the user abandoned. Idempotent. */
export async function DELETE(req: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const objectKey = req.nextUrl.searchParams.get('objectKey') ?? '';
  const kind = (req.nextUrl.searchParams.get('kind') ?? '') as CapacityImportKind;
  if (!KINDS.includes(kind)) return badRequest('Unknown upload kind.');

  try {
    assertObjectKey(objectKey, kind);
  } catch {
    return badRequest('That upload reference is not valid.');
  }

  await removeObjects([objectKey]);
  return new NextResponse(null, { status: 204 });
}
