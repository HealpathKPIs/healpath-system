import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — plain ESM module shared verbatim with the CLI importer (single source of truth)
import { parseWorkbook, loadDatabase } from '@/lib/import-core.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin → Data Import endpoint. mode=preview parses/cleans only (NO database
// write); mode=import runs the existing loader and streams NDJSON progress.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  const mode = String(form.get('mode') ?? 'preview');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  let parsed: any;
  try {
    parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  if (mode === 'preview') {
    return NextResponse.json({ counts: parsed.counts, skips: parsed.skips });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      send({ stage: 'start', counts: parsed.counts });
      try {
        const result = await loadDatabase(parsed, {
          onProgress: (p: { table: string; inserted: number; total: number }) => send({ stage: 'progress', ...p }),
        });
        send({ stage: 'done', loaded: result.loaded, durationMs: result.loadMs, skips: parsed.skips });
      } catch (e) {
        send({ stage: 'error', message: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
