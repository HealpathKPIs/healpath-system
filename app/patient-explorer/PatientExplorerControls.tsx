'use client';

import type { PatientExplorerData } from '@/lib/patient-explorer';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const inputStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'transparent',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: 13,
  minWidth: 170,
};

const buttonStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '0 12px',
  fontWeight: 800,
  cursor: 'pointer',
};

function downloadBlob(name: string, type: string, content: BlobPart) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadExport(params: URLSearchParams, type: 'csv' | 'excel' | 'summary') {
  const next = new URLSearchParams(params.toString());
  if (type === 'summary') {
    next.set('type', 'summary');
    next.set('format', 'excel');
  } else {
    next.set('type', 'list');
    next.set('format', type);
  }
  const response = await fetch(`/api/patient-explorer/export?${next.toString()}`);
  if (!response.ok) throw new Error('Patient Explorer export failed.');
  const contentType = response.headers.get('content-type') ?? 'text/plain;charset=utf-8';
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match?.[1] ?? `patient-explorer.${type === 'csv' ? 'csv' : 'xls'}`;
  downloadBlob(name, contentType, await response.text());
}

export default function PatientExplorerControls({ data }: { data: PatientExplorerData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [status, setStatus] = useState('');

  function push(next: URLSearchParams) {
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    if (key === 'doctor') {
      next.delete('sel');
      next.delete('selv');
    }
    push(next);
  }

  function applyText(formData: FormData) {
    const next = new URLSearchParams(params.toString());
    ['q', 'disease', 'medication', 'activeIngredient'].forEach((key) => {
      const value = String(formData.get(key) ?? '').trim();
      if (value) next.set(key, value);
      else next.delete(key);
    });
    next.delete('page');
    push(next);
  }

  async function onExport(kind: 'csv' | 'excel' | 'summary') {
    try {
      setStatus('Preparing export...');
      await downloadExport(new URLSearchParams(params.toString()), kind);
      setStatus(kind === 'summary' ? 'Executive summary export prepared.' : `Patient list ${kind.toUpperCase()} export prepared.`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <p className="section-title" style={{ margin: 0 }}>Patient filters</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onExport('excel')} style={buttonStyle}>Export Excel</button>
          <button type="button" onClick={() => onExport('csv')} style={buttonStyle}>Export CSV</button>
          <button type="button" onClick={() => onExport('summary')} style={{ ...buttonStyle, background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', borderColor: 'transparent' }}>Export Summary</button>
        </div>
      </div>

      <div className="filters" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <select aria-label="Month" value={data.filters.month ?? ''} onChange={(event) => setFilter('month', event.target.value)}>
          <option value="">All months</option>
          {data.options.months.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
        <select aria-label="Specialty" value={data.filters.specialty ?? ''} onChange={(event) => setFilter('specialty', event.target.value)}>
          <option value="">All specialties</option>
          {data.options.specialties.map((specialty) => <option key={specialty} value={specialty}>{specialty}</option>)}
        </select>
        <select aria-label="Doctor" value={data.filters.doctor ?? ''} onChange={(event) => setFilter('doctor', event.target.value)}>
          <option value="">All doctors</option>
          {data.options.doctors.map((doctor) => <option key={doctor} value={doctor}>{doctor}</option>)}
        </select>
        <select aria-label="Risk Carrier" value={data.filters.riskCarrier ?? ''} onChange={(event) => setFilter('riskCarrier', event.target.value)}>
          <option value="">All</option>
          {data.options.riskCarriers.map((carrier) => <option key={carrier} value={carrier}>{carrier}</option>)}
        </select>
        <select aria-label="Consultant" value={data.filters.consultant ?? ''} onChange={(event) => setFilter('consultant', event.target.value)}>
          <option value="">All consultants</option>
          {data.options.consultants.map((consultant) => <option key={consultant} value={consultant}>{consultant}</option>)}
        </select>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyText(new FormData(event.currentTarget));
        }}
        className="filters"
        style={{ flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input name="q" defaultValue={data.filters.q ?? ''} placeholder="Search patient ID or name" style={{ ...inputStyle, minWidth: 230 }} />
        <input name="disease" defaultValue={data.filters.disease ?? ''} placeholder="Disease" style={inputStyle} />
        <input name="medication" defaultValue={data.filters.medication ?? ''} placeholder="Medication" style={inputStyle} />
        <input name="activeIngredient" defaultValue={data.filters.activeIngredient ?? ''} placeholder="Active Ingredient" style={inputStyle} />
        <button type="submit" style={{ ...buttonStyle, background: 'var(--surface-2)' }}>Apply</button>
        <a href="/patient-explorer" style={{ ...buttonStyle, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'var(--text-muted)' }}>Clear</a>
      </form>
      <p className="sr-only" aria-live="polite">{status}</p>
    </section>
  );
}
