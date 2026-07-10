'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Admin → Data Import. UI ONLY — parsing/loading is the existing importer
// (lib/import-core.mjs, shared with scripts/pg-import.mjs) behind /api/admin/import.

type Counts = Record<string, number>;
type Skips = Record<string, { source: number; blank: number; orphan: number; loaded: number }>;
type Phase = 'idle' | 'previewing' | 'ready' | 'importing' | 'done' | 'error';

// Display order/labels per spec: Visits, Drug, Diagnosis, Laboratory, Scans.
const DISPLAY: [string, string][] = [
  ['visits', 'Visits'],
  ['drug_fact', 'Drug'],
  ['diagnosis_fact', 'Diagnosis'],
  ['lab_fact', 'Laboratory'],
  ['scan_fact', 'Scans'],
];
const LABEL: Record<string, string> = Object.fromEntries(DISPLAY);

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', background: 'var(--surface)', boxShadow: 'var(--shadow-xs)' };

// Upload History (Sprint 27) — persistence is browser-local (localStorage): the
// import pipeline has no server-side upload log, so this is UI-only history.
interface UploadEntry { date: string; file: string; status: 'Completed' | 'Failed'; rows: number; durationMs: number }
const HISTORY_KEY = 'hp-upload-history';
const HISTORY_MAX = 10;

export default function DataImport() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Counts | null>(null);
  const [skips, setSkips] = useState<Skips | null>(null);
  const [currentTable, setCurrentTable] = useState<string | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ loaded: Counts; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const insertedRef = useRef<Record<string, number>>({});
  const [, force] = useState(0);
  const [history, setHistory] = useState<UploadEntry[]>([]);

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')); } catch { /* ignore */ }
  }, []);

  const recordUpload = useCallback((entry: UploadEntry) => {
    setHistory((cur) => {
      const next = [entry, ...cur].slice(0, HISTORY_MAX);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage full/blocked */ }
      return next;
    });
  }, []);

  // Step 1+2: file selected -> ✔ File Loaded -> automatic preview (parse only, NO db write).
  const onFile = useCallback(async (f: File) => {
    setFile(f); setPreview(null); setSkips(null); setDoneInfo(null); setError(null);
    insertedRef.current = {};
    setPhase('previewing');
    const fd = new FormData();
    fd.set('file', f); fd.set('mode', 'preview');
    try {
      const res = await fetch('/api/admin/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Preview failed'); setPhase('error'); return; }
      setPreview(data.counts); setSkips(data.skips); setPhase('ready');
    } catch (e) { setError((e as Error).message); setPhase('error'); }
  }, []);

  // Step 4: import with streamed progress.
  async function runImport() {
    if (!file) return;
    setPhase('importing'); setCurrentTable(null); setError(null);
    insertedRef.current = {};
    const fd = new FormData();
    fd.set('file', file); fd.set('mode', 'import');
    try {
      const res = await fetch('/api/admin/import', { method: 'POST', body: fd });
      if (!res.ok || !res.body) { setError('Import failed'); setPhase('error'); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.stage === 'progress') {
            insertedRef.current[ev.table] = ev.inserted;
            setCurrentTable(ev.table);
            force((n) => n + 1);
          } else if (ev.stage === 'done') {
            setDoneInfo({ loaded: ev.loaded, durationMs: ev.durationMs });
            setPhase('done');
            const rows = Object.values(ev.loaded as Counts).reduce((a, b) => a + b, 0);
            recordUpload({ date: new Date().toISOString(), file: file.name, status: 'Completed', rows, durationMs: ev.durationMs });
          } else if (ev.stage === 'error') {
            setError(ev.message); setPhase('error');
            recordUpload({ date: new Date().toISOString(), file: file.name, status: 'Failed', rows: 0, durationMs: 0 });
          }
        }
      }
    } catch (e) { setError((e as Error).message); setPhase('error'); }
  }

  const totalRows = preview ? DISPLAY.reduce((a, [t]) => a + (preview[t] ?? 0), 0) : 0;
  const doneRows = Object.values(insertedRef.current).reduce((a, b) => a + b, 0);
  const pct = totalRows ? Math.min(100, Math.round((doneRows / totalRows) * 100)) : 0;
  const skippedTotal = skips ? Object.values(skips).reduce((a, s) => a + s.blank + s.orphan, 0) : 0;

  return (
    <>
      <div className="pagehead"><h1 className="pagetitle">Data Import</h1></div>

      <div className="card" style={{ maxWidth: 720, display: 'grid', gap: 16 }}>
        {/* Step 1 — dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0} aria-label="Drop Excel here or browse file"
          style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 12, padding: '34px 20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'var(--accent-soft)' : 'var(--surface-2)', transition: 'background .15s ease, border-color .15s ease' }}
        >
          <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>Drop Excel Here</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-soft)', margin: '6px 0' }}>or</div>
          <span style={{ display: 'inline-block', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--text)' }}>Browse File</span>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>

        {file && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontWeight: 650, fontSize: 13.5 }}>
            ✔ File Loaded <span style={{ color: 'var(--text-soft)', fontWeight: 500 }}>— {file.name}</span>
          </div>
        )}

        {phase === 'previewing' && <div style={{ ...card, color: 'var(--text-soft)', fontSize: 13.5 }}>Reading workbook…</div>}
        {phase === 'error' && <div style={{ ...card, color: 'var(--danger)', fontSize: 13.5, background: 'var(--danger-soft)' }}>{error}</div>}

        {/* Step 2 — preview (parse only) */}
        {preview && phase !== 'importing' && phase !== 'done' && (
          <div style={card}>
            <p className="section-title">Preview — rows ready to import</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {DISPLAY.map(([t, label]) => (
                <div key={t} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', padding: '6px 2px', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{(preview[t] ?? 0).toLocaleString()}</b>
                </div>
              ))}
            </div>
            {skippedTotal > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)' }}>
                {skippedTotal.toLocaleString()} source row(s) will be skipped (blank or unmatched VisitID).
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-soft)' }}>
              No data has been written. Note: re-importing an already-loaded extract appends duplicate fact rows.
            </div>
          </div>
        )}

        {/* Step 3 — import button */}
        {phase === 'ready' && (
          <button type="button" onClick={runImport}
            style={{ height: 44, border: 0, borderRadius: 10, background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '.02em', cursor: 'pointer', boxShadow: '0 8px 18px rgba(99,102,241,.3)' }}>
            IMPORT DATA
          </button>
        )}

        {/* Step 4 — progress */}
        {phase === 'importing' && (
          <div style={card}>
            <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text)', marginBottom: 10 }}>
              {currentTable ? `Importing ${LABEL[currentTable] ?? currentTable}...` : 'Uploading...'}
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 'inherit', background: 'linear-gradient(90deg, var(--accent), #8b83ff)', transition: 'width .2s ease' }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-soft)', fontVariantNumeric: 'tabular-nums' }}>{doneRows.toLocaleString()} / {totalRows.toLocaleString()} rows · {pct}%</div>
          </div>
        )}

        {/* Step 5 + 6 — completion + refresh */}
        {phase === 'done' && doneInfo && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
              ✔ Import Completed Successfully
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {DISPLAY.map(([t, label]) => (
                <div key={t} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', padding: '6px 2px', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{(doneInfo.loaded[t] ?? 0).toLocaleString()}</b>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 2px', fontSize: 13.5 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Duration</span>
                <b>{(doneInfo.durationMs / 1000).toFixed(1)}s</b>
              </div>
            </div>
            <button type="button" onClick={() => { window.location.href = '/'; }}
              style={{ marginTop: 14, width: '100%', height: 42, border: 0, borderRadius: 10, background: 'linear-gradient(180deg, #1e293b, #0f172a)', color: '#fff', fontSize: 13.5, fontWeight: 650, cursor: 'pointer' }}>
              Refresh Dashboard
            </button>
          </div>
        )}
      </div>

      {/* Upload History (Sprint 27) — latest uploads, stored in this browser */}
      <div className="card" style={{ maxWidth: 720, marginTop: 20 }}>
        <p className="section-title">Upload History</p>
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No uploads recorded on this device yet.</p>
        ) : (
          <div className="table-wrap">
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ cursor: 'default' }}>Date</th>
                  <th style={{ cursor: 'default' }}>File</th>
                  <th style={{ cursor: 'default' }}>Status</th>
                  <th className="num" style={{ cursor: 'default' }}>Rows</th>
                  <th className="num" style={{ cursor: 'default' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.date}-${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.date).toLocaleString()}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.file}>{h.file}</td>
                    <td style={{ color: h.status === 'Completed' ? 'var(--success)' : 'var(--danger)', fontWeight: 650 }}>{h.status}</td>
                    <td className="num">{h.rows.toLocaleString()}</td>
                    <td className="num">{h.durationMs ? `${(h.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
