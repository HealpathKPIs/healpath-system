import 'server-only';

import { randomUUID } from 'node:crypto';

import { supabase, hasSupabase } from '@/lib/supabase';

import type { CapacityImportKind } from './types';

/**
 * Upload handling for capacity workbooks.
 *
 * The appointment export is ~9 MB. Vercel rejects any request body over 4.5 MB
 * at the edge, before the route handler is invoked, so the file cannot be
 * posted to this application at all. Instead the browser uploads straight to
 * Supabase Storage with a signed URL and posts only the resulting object key,
 * which is a few dozen bytes.
 *
 * The bucket is private and carries no storage.objects policies. The signed URL
 * is minted by the service role and honoured by Storage directly, and the
 * download below also uses the service role, so no browser session needs any
 * standing access to the bucket.
 */

export const CAPACITY_BUCKET = 'capacity-imports';

/** Matches the Vercel-independent bucket limit set in the migration. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const KEY_RE = /^capacity\/(schedule|appointments)\/\d{4}\/[0-9a-f-]{36}\.xlsx$/;

export class CapacityStorageError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 503) {
    super(message);
    this.name = 'CapacityStorageError';
  }
}

function client() {
  if (!hasSupabase || !supabase) {
    throw new CapacityStorageError('Supabase storage is not configured.', 503);
  }
  return supabase;
}

/**
 * Build the object key.
 *
 * The uploader's filename never forms part of the key — a UUID does — which
 * removes path traversal and header injection as a class. The real filename
 * travels separately in the request body and is recorded in the ledger.
 */
export function buildObjectKey(kind: CapacityImportKind): string {
  return `capacity/${kind}/${new Date().getFullYear()}/${randomUUID()}.xlsx`;
}

/** Reject anything that is not a key we minted, for the declared kind. */
export function assertObjectKey(objectKey: string, kind: CapacityImportKind): void {
  if (!KEY_RE.test(objectKey) || !objectKey.startsWith(`capacity/${kind}/`)) {
    throw new CapacityStorageError('That upload reference is not valid.', 400);
  }
}

export interface SignedUpload {
  objectKey: string;
  signedUrl: string;
  token: string;
}

export async function createSignedUpload(kind: CapacityImportKind): Promise<SignedUpload> {
  const objectKey = buildObjectKey(kind);
  const { data, error } = await client().storage.from(CAPACITY_BUCKET).createSignedUploadUrl(objectKey);
  if (error || !data) {
    throw new CapacityStorageError(error?.message ?? 'Could not prepare the upload.', 503);
  }
  return { objectKey, signedUrl: data.signedUrl, token: data.token };
}

export async function downloadObject(objectKey: string): Promise<Buffer> {
  const { data, error } = await client().storage.from(CAPACITY_BUCKET).download(objectKey);
  if (error || !data) {
    // An expired or swept object is a 404, not a server fault: the user simply
    // needs to upload again.
    throw new CapacityStorageError('That upload is no longer available. Please upload the file again.', 404);
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Remove uploaded objects. Never throws: a file left behind is a tidiness
 * problem, and must not turn a completed import into a reported failure.
 */
export async function removeObjects(objectKeys: string[]): Promise<void> {
  if (!objectKeys.length || !hasSupabase || !supabase) return;
  try {
    await supabase.storage.from(CAPACITY_BUCKET).remove(objectKeys);
  } catch (error) {
    console.warn('capacity: could not remove uploaded object(s):', (error as Error).message);
  }
}
