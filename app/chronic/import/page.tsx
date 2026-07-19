'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChronicCalendarEntry, CHRONIC_CALENDAR_SEED } from '@/lib/chronic-calendar';
import {
  CHRONIC_SHEETS,
  type ChronicPreview,
  type ChronicSheetName,
  type ChronicSheetPreview,
  parseWorkbook,
  validateWorkbook,
} from '@/lib/chronic-parser';
// Display only — all normalization logic lives in lib/chronic-normalizer.ts.
import { type ChronicNormalizationReport, normalizeChronicRows } from '@/lib/chronic-normalizer';

type Phase = 'idle' | 'reading' | 'valid' | 'invalid' | 'importing' | 'done' | 'error';

interface ImportResult {
  importedRows: number;
  patients: number;
  weeks: string[];
  periods: string[];
  weekRange: string;
  missingWeeks: number[];
  normalization?: ChronicNormalizationReport;
  durationMs: number;
  batch: {
    batch_id: string;
    week: string;
    month: string;
    file_name: string;
    pre_rows: number;
    post_rows: number;
    status: string;
  };
}

interface ChronicImportHistoryEntry {
  date: string;
  file: string;
  status: 'Completed' | 'Failed';
  rows: number;
  patients: number;
  weeks: string;
  durationMs: number;
}

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', background: 'var(--surface)', boxShadow: 'var(--shadow-xs)' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border-soft)', padding: '7px 2px', fontSize: 13.5 };
const button: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' };
const HISTORY_KEY = 'hp-chronic-import-history';
const HISTORY_MAX = 10;

// everything the UI needs — detected columns, whether the required columns are
function ValidationLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ok ? 'var(--success)' : 'var(--danger)', fontWeight: 650, fontSize: 13.5 }}>
      <span aria-hidden="true">{ok ? '✓' : '!'}</span>
      <span>{label}</span>
    </div>
  );
}

function PreviewCard({ title, preview }: { title: ChronicSheetName; preview: ChronicSheetPreview }) {
  const items = [
    ['Rows', preview.rows.toLocaleString()],
    ['Patients', preview.patients.toLocaleString()],
    ['Detected Periods', preview.periods],
    ['Recommendation Count', preview.recommendationCount.toLocaleString()],
    ['Issue Count', preview.issueCount.toLocaleString()],
    ['Medication Count', preview.medicationCount.toLocaleString()],
  ];

  return (
    <div style={card}>
      <p className="section-title">{title}</p>
      <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, background: 'var(--surface-2)', padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)', marginBottom: 6 }}>
          Detected Columns
        </div>
        <div style={{ display: 'grid', gap: 2 }}>
          {[
            ['Patient ID', preview.detectedColumns.patient ?? 'Not found'],
            ['Week', preview.detectedColumns.week ?? 'Not found'],
            ['Recommendation', preview.detectedColumns.recommendation ?? 'Not found'],
            ['Issues', `${preview.detectedColumns.issues.length.toLocaleString()} column${preview.detectedColumns.issues.length === 1 ? '' : 's'} detected`],
          ].map(([label, value]) => (
            <div key={label} style={row}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</b>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 2 }}>
        {items.map(([label, value]) => (
          <div key={label} style={row}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
            <b style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChronicImportCenter() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ChronicPreview | null>(null);
  const [normalization, setNormalization] = useState<ChronicNormalizationReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ChronicImportHistoryEntry[]>([]);
  // The business calendar (single source of truth) — loaded from the server so
  // the preview reflects new weeks with no code change; seed is the fallback.
  const [calendar, setCalendar] = useState<ChronicCalendarEntry[]>(CHRONIC_CALENDAR_SEED);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'));
    } catch {
      setHistory([]);
    }
    fetch('/api/chronic/import')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (Array.isArray(data?.calendar) && data.calendar.length) setCalendar(data.calendar); })
      .catch(() => { /* keep seed fallback */ });
  }, []);

  const recordHistory = useCallback((entry: ChronicImportHistoryEntry) => {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, HISTORY_MAX);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore blocked or full browser storage.
      }
      return next;
    });
  }, []);

  const onFile = useCallback(async (selected: File) => {
    setFile(selected);
    setPhase('reading');
    setPreview(null);
    setNormalization(null);
    setResult(null);
    setErrors([]);

    try {
      const workbook = parseWorkbook(await selected.arrayBuffer(), calendar);
      setPreview(workbook.preview);
      if (workbook.validation.ready) {
        // Dry-run of the normalization layer (module call only — logic lives in
        // lib/chronic-normalizer.ts). The server re-runs it authoritatively.
        setNormalization(normalizeChronicRows([...(workbook.parsed.Pre ?? []), ...(workbook.parsed.Post ?? [])]).report);
      }
      setPhase(workbook.validation.ready ? 'valid' : 'invalid');
    } catch (error) {
      setErrors([(error as Error).message]);
      setPhase('invalid');
    }
  }, [calendar]);

  async function runImport() {
    const validation = validateWorkbook(preview);
    if (!file || !validation.ready) return;
    setPhase('importing');
    setErrors([]);
    setResult(null);
    const form = new FormData();
    form.set('file', file);
    form.set('mode', 'import');

    // The loading state is ALWAYS cleared by the finally block below — no
    // path (non-2xx, non-JSON body, thrown error) can leave the button stuck
    // on "Importing...". Pessimistic default; each path overrides it.
    let nextPhase: Phase = 'error';
    try {
      const response = await fetch('/api/chronic/import', { method: 'POST', body: form });
      // A non-JSON error body (e.g. an HTML error page) must not wedge the UI.
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const nextErrors = Array.isArray(data?.errors)
          ? data.errors
          : [data?.error ?? `Import failed (HTTP ${response.status}).`];
        setErrors(nextErrors);
        nextPhase = response.status === 409 ? 'invalid' : 'error';
        recordHistory({ date: new Date().toISOString(), file: file.name, status: 'Failed', rows: 0, patients: 0, weeks: '', durationMs: 0 });
        return;
      }
      setResult(data);
      recordHistory({
        date: new Date().toISOString(),
        file: file.name,
        status: 'Completed',
        rows: data.importedRows,
        patients: data.patients,
        weeks: data.weekRange ?? (Array.isArray(data.weeks) ? data.weeks.join(', ') : ''),
        durationMs: data.durationMs,
      });
      nextPhase = 'done';
    } catch (error) {
      setErrors([(error as Error).message]);
      nextPhase = 'error';
      recordHistory({ date: new Date().toISOString(), file: file.name, status: 'Failed', rows: 0, patients: 0, weeks: '', durationMs: 0 });
    } finally {
      setPhase(nextPhase);
    }
  }

  const validation = validateWorkbook(preview);
  const visibleErrors = validation.errors.length ? validation.errors : errors;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Chronic Import Center</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Validate and import Pre and Post chronic care workbooks into Supabase.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 780, display: 'grid', gap: 16 }}>
        <div
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) onFile(dropped);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop Excel here or browse file"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 12, padding: '34px 20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'var(--accent-soft)' : 'var(--surface-2)', transition: 'background .15s ease, border-color .15s ease' }}
        >
          <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>Drop Excel Here</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-soft)', margin: '6px 0' }}>or</div>
          <span style={button}>Browse</span>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onFile(selected); }} />
        </div>

        {file && (
          <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 13.5 }}>
            Read only: <b style={{ color: 'var(--text)' }}>Sheet Pre</b> and <b style={{ color: 'var(--text)' }}>Sheet Post</b>
            <span style={{ color: 'var(--text-soft)' }}> - {file.name}</span>
          </div>
        )}

        {phase === 'reading' && <div style={{ ...card, color: 'var(--text-soft)', fontSize: 13.5 }}>Reading workbook...</div>}

        {(phase === 'valid' || phase === 'invalid' || phase === 'error' || phase === 'done') && (
          <div style={card}>
            <p className="section-title">Validate</p>
            <div style={{ display: 'grid', gap: 9 }}>
              <ValidationLine ok={validation.requiredColumns} label="Required columns found" />
              <ValidationLine ok={validation.weekDetected} label="Week detected" />
              <ValidationLine ok={validation.ready} label="Ready to import" />
            </div>
            {visibleErrors.length > 0 && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
                {visibleErrors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}
          </div>
        )}

        {(result?.normalization ?? normalization) && (
          <div style={card}>
            <p className="section-title">Normalization</p>
            <div style={{ display: 'grid', gap: 2 }}>
              {(() => {
                const report = result?.normalization ?? normalization!;
                return [
                  ['Rows', report.rows.toLocaleString()],
                  ['Normalized', report.normalized.toLocaleString()],
                  ['Mapped', report.mapped.toLocaleString()],
                  ['Unknown', report.unknown.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} style={row}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                    <b style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</b>
                  </div>
                ));
              })()}
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
              Values are normalized to the official categories before anything is written to the database.
            </p>
          </div>
        )}

        {preview && (
          <div style={{ display: 'grid', gap: 16 }}>
            <p className="section-title" style={{ marginBottom: -2 }}>Preview</p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {CHRONIC_SHEETS.map((sheet) => preview[sheet] && <PreviewCard key={sheet} title={sheet} preview={preview[sheet]} />)}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          <button
            type="button"
            disabled={!validation.ready || phase === 'importing' || phase === 'done'}
            onClick={runImport}
            style={{
              height: 44,
              border: 0,
              borderRadius: 10,
              background: validation.ready && phase !== 'importing' && phase !== 'done' ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))' : 'var(--surface-3)',
              color: validation.ready && phase !== 'importing' && phase !== 'done' ? '#fff' : 'var(--text-soft)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '.02em',
              cursor: validation.ready && phase !== 'importing' && phase !== 'done' ? 'pointer' : 'not-allowed',
              boxShadow: validation.ready && phase !== 'importing' && phase !== 'done' ? '0 8px 18px rgba(99,102,241,.3)' : 'none',
            }}
          >
            {phase === 'importing' ? 'IMPORTING...' : phase === 'done' ? 'IMPORTED' : 'IMPORT DATA'}
          </button>
          {phase === 'importing' && <p className="muted" style={{ margin: 0 }}>Uploading to Supabase...</p>}
        </div>

        {result && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
              <span aria-hidden="true">✓</span> Import Completed Successfully
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {[
                ['Imported Rows', result.importedRows.toLocaleString()],
                ['Patients', result.patients.toLocaleString()],
                ['Periods Found', String(result.periods?.length ?? 0)],
                ['Weeks Found', result.weekRange || '-'],
                ['Duration', `${(result.durationMs / 1000).toFixed(1)}s`],
                ['Batch', result.batch.batch_id],
              ].map(([label, value]) => (
                <div key={label} style={row}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</b>
                </div>
              ))}
            </div>
            {result.periods?.length ? (
              <p className="muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
                Periods: {result.periods.join(', ')}
              </p>
            ) : null}
            {result.missingWeeks?.length ? (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border-soft)', fontSize: 12.5 }}>
                <div style={{ fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-soft)', marginBottom: 4 }}>
                  Missing Weeks (informational)
                </div>
                <div style={{ color: 'var(--text-muted)', fontWeight: 650 }}>{result.missingWeeks.join(', ')}</div>
              </div>
            ) : null}
          </div>
        )}

        <div style={card}>
          <p className="section-title">Import History</p>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No chronic imports recorded on this device yet.</p>
          ) : (
            <div className="table-wrap">
              <table style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th style={{ cursor: 'default' }}>Date</th>
                    <th style={{ cursor: 'default' }}>File</th>
                    <th style={{ cursor: 'default' }}>Status</th>
                    <th className="num" style={{ cursor: 'default' }}>Rows</th>
                    <th className="num" style={{ cursor: 'default' }}>Patients</th>
                    <th style={{ cursor: 'default' }}>Weeks</th>
                    <th className="num" style={{ cursor: 'default' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry, index) => (
                    <tr key={`${entry.date}-${index}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(entry.date).toLocaleString()}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.file}>{entry.file}</td>
                      <td style={{ color: entry.status === 'Completed' ? 'var(--success)' : 'var(--danger)', fontWeight: 650 }}>{entry.status}</td>
                      <td className="num">{entry.rows.toLocaleString()}</td>
                      <td className="num">{entry.patients.toLocaleString()}</td>
                      <td>{entry.weeks || '-'}</td>
                      <td className="num">{entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
