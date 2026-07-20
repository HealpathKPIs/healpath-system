'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Phase = 'idle' | 'previewing' | 'ready' | 'importing' | 'done' | 'error';

interface ValidationError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

interface Summary {
  totalRows: number;
  inserted?: number;
  updated?: number;
  skipped: number;
  durationMs?: number;
  errors: ValidationError[];
  rows?: { patient_id: string; risk_carrier: string }[];
  headers?: { patientId: string | null; riskCarrier: string | null };
}

interface Stats {
  lastImportAt: string | null;
  rowsImported: number;
  currentCount: number;
}

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', background: 'var(--surface)', boxShadow: 'var(--shadow-xs)' };
const statCard: React.CSSProperties = { ...card, minHeight: 112, display: 'grid', alignContent: 'space-between', gap: 12 };
const buttonBase: React.CSSProperties = { height: 42, borderRadius: 10, padding: '0 16px', fontSize: 13.5, fontWeight: 750, cursor: 'pointer' };

function formatNumber(value: number | undefined) {
  if (value === undefined) return '-';
  return value.toLocaleString();
}

function formatDate(value: string | null, mode: 'date' | 'time') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return mode === 'date' ? date.toLocaleDateString() : date.toLocaleTimeString();
}

function SummaryPanel({ summary, phase }: { summary: Summary | null; phase: Phase }) {
  const errors = summary?.errors.length ?? 0;
  const rows = [
    ['Total Rows', formatNumber(summary?.totalRows)],
    ['Inserted', phase === 'done' ? formatNumber(summary?.inserted) : '-'],
    ['Updated', phase === 'done' ? formatNumber(summary?.updated) : '-'],
    ['Skipped', formatNumber(summary?.skipped)],
    ['Errors', formatNumber(errors)],
    ['Import Duration', phase === 'done' && summary?.durationMs !== undefined ? `${(summary.durationMs / 1000).toFixed(1)}s` : '-'],
  ];

  return (
    <div style={card}>
      <p className="section-title">Import Summary</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ border: '1px solid var(--border-soft)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface-2)' }}>
            <div style={{ color: 'var(--text-soft)', fontSize: 11, fontWeight: 850, letterSpacing: '.07em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ marginTop: 8, color: 'var(--text-strong)', fontSize: 24, fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>
      {summary?.headers ? (
        <div style={{ marginTop: 12, color: 'var(--text-soft)', fontSize: 12.5 }}>
          Detected headers: {summary.headers.patientId ?? 'Missing INDIVIDUAL NUMBER'} / {summary.headers.riskCarrier ?? 'Missing Risk Carrier'}
        </div>
      ) : null}
    </div>
  );
}

export default function PatientMasterPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<Stats>({ lastImportAt: null, rowsImported: 0, currentCount: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/patient-master')
      .then((res) => res.json())
      .then((data) => {
        if (alive && data.stats) setStats(data.stats);
      })
      .catch(() => {
        if (alive) setMessage('Patient Master status is temporarily unavailable.');
      });
    return () => { alive = false; };
  }, []);

  const canImport = useMemo(() => phase === 'ready' && Boolean(file) && (summary?.errors.length ?? 0) === 0, [file, phase, summary]);

  async function previewFile(nextFile: File) {
    setFile(nextFile);
    setPhase('previewing');
    setSummary(null);
    setMessage(null);

    const form = new FormData();
    form.set('file', nextFile);
    form.set('mode', 'preview');

    try {
      const res = await fetch('/api/admin/patient-master', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'The file could not be validated.');
        setPhase('error');
        return;
      }
      setSummary(data.summary);
      setPhase(data.summary.errors.length ? 'error' : 'ready');
      setMessage(data.summary.errors.length ? 'Fix the validation errors before importing.' : 'File validated. Ready to import.');
    } catch {
      setMessage('The file could not be read. Upload a valid Excel workbook.');
      setPhase('error');
    }
  }

  async function importFile() {
    if (!file || !canImport) return;
    setPhase('importing');
    setMessage(null);
    const form = new FormData();
    form.set('file', file);
    form.set('mode', 'import');

    try {
      const res = await fetch('/api/admin/patient-master', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setSummary(data.summary ?? summary);
        setMessage(data.error ?? 'Patient Master import failed.');
        setPhase('error');
        return;
      }
      setSummary(data.summary);
      setStats(data.stats);
      setMessage('Patient Master import completed successfully.');
      setPhase('done');
    } catch {
      setMessage('Patient Master import failed. Please try again.');
      setPhase('error');
    }
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setSummary(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Patient Master</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Upload the independent patient-to-risk-carrier master file.</p>
        </div>
      </div>

      <div className="grid kpirow" style={{ marginBottom: 20 }}>
        <div style={statCard}>
          <div className="kpi-label">Last Import Date</div>
          <div style={{ color: 'var(--text-strong)', fontSize: 24, fontWeight: 850 }}>{formatDate(stats.lastImportAt, 'date')}</div>
        </div>
        <div style={statCard}>
          <div className="kpi-label">Last Import Time</div>
          <div style={{ color: 'var(--text-strong)', fontSize: 24, fontWeight: 850 }}>{formatDate(stats.lastImportAt, 'time')}</div>
        </div>
        <div style={statCard}>
          <div className="kpi-label">Rows Imported</div>
          <div style={{ color: 'var(--text-strong)', fontSize: 30, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{stats.rowsImported.toLocaleString()}</div>
        </div>
        <div style={statCard}>
          <div className="kpi-label">Current Patient Master Count</div>
          <div style={{ color: 'var(--text-strong)', fontSize: 30, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{stats.currentCount.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <p className="section-title">Upload Excel</p>
          <div
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const nextFile = event.dataTransfer.files?.[0];
              if (nextFile) previewFile(nextFile);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Upload Patient Master Excel file"
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
              borderRadius: 12,
              padding: '34px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'var(--accent-soft)' : 'var(--surface-2)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 750, color: 'var(--text)' }}>{file ? file.name : 'Drop Patient Master Excel here'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-soft)', margin: '7px 0' }}>Accepted columns: Risk Carrier and INDIVIDUAL NUMBER</div>
            <span style={{ display: 'inline-block', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, background: 'var(--surface)', color: 'var(--text)' }}>Browse File</span>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                if (nextFile) previewFile(nextFile);
              }} />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={importFile}
              disabled={!canImport || phase === 'importing'}
              style={{
                ...buttonBase,
                border: 0,
                background: canImport ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))' : 'var(--surface-3)',
                color: canImport ? '#fff' : 'var(--text-soft)',
                boxShadow: canImport ? '0 8px 18px rgba(99,102,241,.3)' : 'none',
              }}
            >
              {phase === 'importing' ? 'Importing...' : 'Import'}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{ ...buttonBase, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            >
              Reset
            </button>
          </div>

          {message ? (
            <div style={{ ...card, background: phase === 'error' ? 'var(--danger-soft)' : 'var(--surface-2)', color: phase === 'error' ? 'var(--danger)' : 'var(--text-muted)', fontSize: 13.5 }}>
              {message}
            </div>
          ) : null}

          {phase === 'previewing' ? <div style={{ ...card, color: 'var(--text-soft)' }}>Validating workbook...</div> : null}

          {summary?.errors.length ? (
            <div style={{ ...card, background: 'var(--danger-soft)' }}>
              <p className="section-title" style={{ color: 'var(--danger)' }}>Validation Errors</p>
              <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto' }}>
                {summary.errors.slice(0, 50).map((error, index) => (
                  <div key={`${error.row}-${error.field}-${index}`} style={{ fontSize: 13, color: 'var(--text)', borderBottom: '1px solid rgba(225,29,72,.14)', paddingBottom: 7 }}>
                    <b>{error.row ? `Row ${error.row}` : 'File'}</b>: {error.message}
                  </div>
                ))}
              </div>
              {summary.errors.length > 50 ? <p className="muted" style={{ margin: '10px 0 0' }}>Showing first 50 errors.</p> : null}
            </div>
          ) : null}
        </div>

        <SummaryPanel summary={summary} phase={phase} />
      </div>
    </>
  );
}
