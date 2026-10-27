import { createHash } from 'node:crypto';

export interface FileFingerprint {
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  fingerprintedAt: string;
}

export function fingerprintBuffer(input: Buffer, fileName: string, fingerprintedAt = new Date().toISOString()): FileFingerprint {
  return {
    fileName,
    fileHash: createHash('sha256').update(input).digest('hex'),
    fileSizeBytes: input.byteLength,
    fingerprintedAt,
  };
}

export async function fingerprintFile(file: File): Promise<FileFingerprint> {
  return fingerprintBuffer(Buffer.from(await file.arrayBuffer()), file.name);
}
