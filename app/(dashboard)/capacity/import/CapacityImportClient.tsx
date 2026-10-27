'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Capacity import.
 *
 * The appointment export is around 9 MB and Vercel rejects any request body
 * over 4.5 MB at the edge, before a route handler runs. So the file never goes
 * through this application: the browser asks for a signed URL, uploads straight
 * to storage, and posts only the resulting object key.
 *
 * A month of schedule is two workbooks (Specialties and Family Medicine) and
 * both must arrive in the same import, because importing them separately would
 * make the second replace the first for the days they share.
 */

type Kind = 'schedule' | 'appointments';
type Phase = 'idle' | 'uploading' | 'previewing' | 'ready' | 'importing' | 'done' | 'error';

interface UploadedFile {
  objectKey: string;
  fileName: string;
  size: number;
}

interface PreviewResponse {
  preview: Record<string, unknown>;
  validation: { ready: boolean; lines: { label: string; ok: boolean; detail: string }[]; errors: string[] };
  coverage: { start: string | null; end: string | null; dates: number };
  replacePlan: { from: string; to: string; rowsToDelete: number; rowsToInsert: number };
  duplicateOf: { fileName: string; completedAt: string | null } | null;
}

interface ImportResponse {
  rowsInserted: number;
  rowsDeleted: number;
  coverage: { start: string | null; end: string | null; dates: number };
  practitioners: { created: number; autoLinked: number; needsReview: { name: string; candidate: string; score: number; why: string }[] };
  specialtiesNew: number;
  durationMs: number;
}

const card: React.CSSProperties = { marginBottom: 20 };
const button: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 8,
  padding: '8px 14px',
  font: 'inherit',
  cursor: 'pointer',
};
const primary: React.CSSProperties = { ...button, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };

/** Upload one file straight to storage. XHR, because fetch cannot report progress. */
function putToStorage(signedUrl: string, file: File, onProgress: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    if (file.type) xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

export default function CapacityImportClient() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('schedule');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setUploaded([]);
    setPreview(null);
    setResult(null);
    setErrors([]);
    setProgress(0);
    setPhase('idle');
  }, []);

  const onFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setErrors([]);
      setResult(null);
      setPreview(null);
      setPhase('uploading');
      setProgress(0);

      // Pessimistic: every exit below sets this, so the UI can never stick on
      // "Uploading" if something throws.
      let next: Phase = 'error';
      try {
        const done: UploadedFile[] = [];
        for (const [index, file] of files.entries()) {
          const signResponse = await fetch('/api/capacity/uploads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, fileName: file.name, fileSize: file.size }),
          });
          const signed = await signResponse.json().catch(() => null);
          if (!signResponse.ok) throw new Error(signed?.error ?? 'Could not prepare the upload.');

          await putToStorage(signed.signedUrl, file, (ratio) =>
            setProgress((index + ratio) / files.length),
          );
          done.push({ objectKey: signed.objectKey, fileName: file.name, size: file.size });
        }
        setUploaded(done);

        setPhase('previewing');
        const previewResponse = await fetch('/api/capacity/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, mode: 'preview', files: done }),
        });
        const body = await previewResponse.json().catch(() => null);
        if (!previewResponse.ok) {
          setErrors(body?.errors ?? [body?.error ?? `Could not read the file (HTTP ${previewResponse.status}).`]);
          return;
        }
        setPreview(body as PreviewResponse);
        next = 'ready';
      } catch (error) {
        setErrors([(error as Error).message]);
      } finally {
        setPhase(next);
      }
    },
    [kind],
  );

  const runImport = useCallback(
    async (force: boolean) => {
      if (!uploaded.length) return;
      setPhase('importing');
      setErrors([]);
      let next: Phase = 'error';
      try {
        const response = await fetch('/api/capacity/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, mode: 'import', files: uploaded, force }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setErrors(body?.errors ?? [body?.error ?? `Import failed (HTTP ${response.status}).`]);
          // A duplicate is recoverable: keep the preview so "Import anyway" works.
          next = response.status === 409 ? 'ready' : 'error';
          return;
        }
        setResult(body as ImportResponse);
        next = 'done';
        router.refresh();
      } catch (error) {
        setErrors([(error as Error).message]);
      } finally {
        setPhase(next);
      }
    },
    [kind, router, uploaded],
  );

  const busy = phase === 'uploading' || phase === 'previewing' || phase === 'importing';

  return (
    <>
      <div className="card" style={card}>
        <p className="section-title">What are you importing?</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['schedule', 'appointments'] as Kind[]).map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => {
                setKind(option);
                reset();
              }}
              style={kind === option ? primary : button}
            >
              {option === 'schedule' ? 'Schedule workbooks' : 'Appointment export'}
            </button>
          ))}
        </div>

        <p className="muted" style={{ marginTop: 0 }}>
          {kind === 'schedule'
            ? 'Select all of the month’s schedule workbooks together — normally the Specialties book and the Family Medicine book. Importing them one at a time would make the second replace the first for the days they share.'
            : 'Select the appointment export. It uploads directly to secure storage, so its size is not limited by the dashboard. Patient name, mobile, MRN, age, gender and insurance are discarded while reading and are never stored.'}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple={kind === 'schedule'}
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void onFiles(files);
          }}
        />
        <button type="button" style={primary} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Working…' : 'Choose file' + (kind === 'schedule' ? 's' : '')}
        </button>
        {uploaded.length > 0 && !busy && (
          <button type="button" style={{ ...button, marginLeft: 8 }} onClick={reset}>
            Start over
          </button>
        )}

        {phase === 'uploading' && (
          <p className="muted" style={{ marginBottom: 0 }}>Uploading… {Math.round(progress * 100)}%</p>
        )}
        {phase === 'previewing' && <p className="muted" style={{ marginBottom: 0 }}>Reading the workbook…</p>}
        {phase === 'importing' && (
          <p className="muted" style={{ marginBottom: 0 }}>Importing. Large exports can take a couple of minutes.</p>
        )}
      </div>

      {errors.length > 0 && (
        <div className="card" style={{ ...card, borderColor: '#dc2626' }}>
          <p className="section-title" style={{ color: '#dc2626' }}>Not imported</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((error) => (
              <li key={error} className="muted">{error}</li>
            ))}
          </ul>
          {preview?.duplicateOf && phase === 'ready' && (
            <button type="button" style={{ ...button, marginTop: 12 }} onClick={() => void runImport(true)}>
              Import anyway, replacing that data
            </button>
          )}
        </div>
      )}

      {preview && phase !== 'done' && (
        <div className="card" style={card}>
          <p className="section-title">Check before importing</p>
          <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
            {preview.validation.lines.map((line) => (
              <li key={line.label} className="muted" style={{ marginBottom: 4 }}>
                <strong style={{ color: line.ok ? 'inherit' : '#b45309' }}>{line.ok ? '✓' : '!'} {line.label}:</strong>{' '}
                {line.detail}
              </li>
            ))}
          </ul>

          <p className="muted">
            This will replace <strong>{preview.replacePlan.rowsToDelete.toLocaleString()}</strong> existing rows between{' '}
            {preview.replacePlan.from} and {preview.replacePlan.to}, and insert{' '}
            <strong>{preview.replacePlan.rowsToInsert.toLocaleString()}</strong>.
          </p>

          <button
            type="button"
            style={primary}
            disabled={busy || !preview.validation.ready}
            onClick={() => void runImport(false)}
          >
            Import
          </button>
        </div>
      )}

      {result && (
        <div className="card" style={card}>
          <p className="section-title">Imported</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li className="muted">
              {result.rowsInserted.toLocaleString()} rows inserted, {result.rowsDeleted.toLocaleString()} replaced,
              covering {result.coverage.start} to {result.coverage.end}.
            </li>
            <li className="muted">
              {result.practitioners.created} new {result.practitioners.created === 1 ? 'doctor' : 'doctors'},{' '}
              {result.practitioners.autoLinked} linked automatically, {result.specialtiesNew} new specialties.
            </li>
            <li className="muted">Took {(result.durationMs / 1000).toFixed(1)} s.</li>
          </ul>

          {result.practitioners.needsReview.length > 0 && (
            <>
              <p className="section-title" style={{ marginTop: 16 }}>
                Worth checking: {result.practitioners.needsReview.length} names looked similar to someone already known
              </p>
              <p className="muted" style={{ marginTop: 0 }}>
                These were kept as separate people rather than merged automatically. Crediting one doctor’s hours to
                another is much harder to undo than confirming a link, so nothing below was joined for you.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.practitioners.needsReview.slice(0, 15).map((row) => (
                  <li key={`${row.name}|${row.candidate}`} className="muted" style={{ marginBottom: 4 }}>
                    <strong>{row.name}</strong> resembles <strong>{row.candidate}</strong> ({Math.round(row.score * 100)}%
                    — {row.why})
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
