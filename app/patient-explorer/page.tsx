import BarRank from '@/components/BarRank';
import KpiCard from '@/components/KpiCard';
import PatientExplorerControls from './PatientExplorerControls';
import { getPatientExplorerData, type PatientExplorerFilters, type PatientExplorerRow } from '@/lib/patient-explorer';
import Link from 'next/link';

type SearchParams = PatientExplorerFilters & { sel?: string; selv?: string };

function effectiveFilters(searchParams: SearchParams): PatientExplorerFilters {
  return {
    ...searchParams,
    disease: searchParams.disease ?? (searchParams.sel === 'disease' ? searchParams.selv : null),
    activeIngredient: searchParams.activeIngredient ?? (searchParams.sel === 'drug' ? searchParams.selv : null),
  };
}

function formatDate(value: string | null) {
  return value || '-';
}

function formatUpdated(value: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

function SortLink({ field, label, data }: { field: string; label: string; data: Awaited<ReturnType<typeof getPatientExplorerData>> }) {
  const params = new URLSearchParams();
  Object.entries(data.filters).forEach(([key, value]) => {
    if (value && key !== 'sort' && key !== 'dir') params.set(key, String(value));
  });
  const active = data.filters.sort === field;
  params.set('sort', field);
  params.set('dir', active && data.filters.dir === 'desc' ? 'asc' : 'desc');
  const suffix = active ? (data.filters.dir === 'desc' ? ' DESC' : ' ASC') : ' SORT';
  return <Link href={`/patient-explorer?${params.toString()}`}>{label}<span className="sort-indicator">{suffix}</span></Link>;
}

function statusStyle(status: PatientExplorerRow['status'] | PatientExplorerRow['acuteStatus'] | PatientExplorerRow['chronicStatus']): React.CSSProperties {
  const tone = status === 'Acute + Chronic'
    ? { color: 'var(--accent-ink)', bg: 'var(--accent-soft)', border: 'var(--accent-border)' }
    : status === 'Acute Only'
      ? { color: 'var(--scans)', bg: 'color-mix(in srgb, var(--scans) 12%, var(--surface))', border: 'color-mix(in srgb, var(--scans) 22%, var(--border))' }
      : status === 'Chronic Only'
        ? { color: 'var(--success)', bg: 'var(--success-soft)', border: 'rgba(5,150,105,.18)' }
        : { color: 'var(--text-muted)', bg: 'var(--surface-3)', border: 'var(--border-soft)' };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
    borderRadius: 999,
    border: `1px solid ${tone.border}`,
    background: tone.bg,
    color: tone.color,
    padding: '3px 9px',
    fontSize: 12,
    fontWeight: 850,
    whiteSpace: 'nowrap',
  };
}

function PatientTable({ data }: { data: Awaited<ReturnType<typeof getPatientExplorerData>> }) {
  if (!data.rows.length) {
    return (
      <section className="card">
        <p className="section-title">Patient table</p>
        <div className="table-empty">No patients match the current filters.</div>
      </section>
    );
  }

  const columns = [
    ['patientId', 'Patient ID'],
    ['patientName', 'Patient Name'],
    ['riskCarrier', 'Risk Carrier'],
    ['acuteVisits', 'Acute Visits'],
    ['chronicReviews', 'Chronic Reviews'],
    ['latestAcuteVisit', 'Latest Acute Visit'],
    ['latestChronicReview', 'Latest Chronic Review'],
    ['acuteStatus', 'Acute Status'],
    ['chronicStatus', 'Chronic Status'],
  ] as const;

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <p className="section-title" style={{ margin: 0 }}>Patient table</p>
        <span className="muted">Page {data.filters.page.toLocaleString()} of {data.totalPages.toLocaleString()}</span>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table style={{ minWidth: 1260 }}>
          <thead>
            <tr>
              {columns.map(([field, label]) => (
                <th key={field} className={field === 'acuteVisits' || field === 'chronicReviews' ? 'num' : ''}>
                  <SortLink field={field} label={label} data={data} />
                </th>
              ))}
              <th><SortLink field="status" label="Status" data={data} /></th>
              <th><SortLink field="patientId" label="Open Patient 360" data={data} /></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.patientId}>
                <td>{row.patientId}</td>
                <td>{row.patientName}</td>
                <td>{row.riskCarrier ?? 'Unknown'}</td>
                <td className="num">{row.acuteVisits.toLocaleString()}</td>
                <td className="num">{row.chronicReviews.toLocaleString()}</td>
                <td>{formatDate(row.latestAcuteVisit)}</td>
                <td>{formatDate(row.latestChronicReview)}</td>
                <td><span style={statusStyle(row.acuteStatus)}>{row.acuteStatus}</span></td>
                <td><span style={statusStyle(row.chronicStatus)}>{row.chronicStatus}</span></td>
                <td><span style={statusStyle(row.status)}>{row.status}</span></td>
                <td>
                  <Link
                    href={`/patient-360?patient=${encodeURIComponent(row.patientId)}`}
                    style={{ height: 30, display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--surface-2)', color: 'var(--text)', fontWeight: 850 }}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination data={data} />
    </section>
  );
}

function Pagination({ data }: { data: Awaited<ReturnType<typeof getPatientExplorerData>> }) {
  const link = (page: number) => {
    const params = new URLSearchParams();
    Object.entries(data.filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    params.set('page', String(page));
    return `/patient-explorer?${params.toString()}`;
  };
  const canPrev = data.filters.page > 1;
  const canNext = data.filters.page < data.totalPages;
  const baseStyle: React.CSSProperties = {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--surface-2)',
    fontWeight: 800,
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
      <span className="muted">{data.totalRows.toLocaleString()} patients returned</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {canPrev ? <Link href={link(data.filters.page - 1)} style={baseStyle}>Previous</Link> : <span style={{ ...baseStyle, opacity: .45 }}>Previous</span>}
        {canNext ? <Link href={link(data.filters.page + 1)} style={baseStyle}>Next</Link> : <span style={{ ...baseStyle, opacity: .45 }}>Next</span>}
      </div>
    </div>
  );
}

function Statistics({ data }: { data: Awaited<ReturnType<typeof getPatientExplorerData>> }) {
  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <p className="section-title" style={{ margin: 0 }}>Dynamic statistics</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {[
          ['Patients Returned', data.stats.patientsReturned.toLocaleString()],
          ['Acute Records Returned', data.stats.acuteRecordsReturned.toLocaleString()],
          ['Chronic Records Returned', data.stats.chronicRecordsReturned.toLocaleString()],
          ['Last Updated', formatUpdated(data.stats.lastUpdated)],
        ].map(([label, value]) => (
          <div key={label} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--surface-2)', padding: '11px 12px' }}>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div>
            <b style={{ display: 'block', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</b>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {data.stats.currentFilters.map((filter) => (
          <span key={filter.label} style={{ border: '1px solid var(--border)', borderRadius: 999, background: 'var(--surface-2)', padding: '5px 9px', color: filter.value === 'All' ? 'var(--text-soft)' : 'var(--text)', fontSize: 12, fontWeight: 750 }}>
            {filter.label}: {filter.value}
          </span>
        ))}
      </div>
    </section>
  );
}

export default async function PatientExplorerPage({ searchParams }: { searchParams: SearchParams }) {
  const data = await getPatientExplorerData(effectiveFilters(searchParams));

  return (
    <section style={{ display: 'grid', gap: 22, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Patient Explorer</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Operational patient discovery across Acute, Chronic, and Patient Master.</p>
        </div>
      </div>

      <PatientExplorerControls data={data} />

      <div className="grid kpirow">
        <KpiCard label="Total Patients" value={data.kpis.totalPatients.toLocaleString()} />
        <KpiCard label="Acute Patients" value={data.kpis.acutePatients.toLocaleString()} />
        <KpiCard label="Chronic Patients" value={data.kpis.chronicPatients.toLocaleString()} />
        <KpiCard label="Acute + Chronic" value={data.kpis.bothPatients.toLocaleString()} />
        <KpiCard label="Acute Visits" value={data.kpis.acuteVisits.toLocaleString()} />
        <KpiCard label="Chronic Reviews" value={data.kpis.chronicReviews.toLocaleString()} />
        <KpiCard label="Avg Acute Visits / Patient" value={data.kpis.avgAcuteVisitsPerPatient.toFixed(2)} />
        <KpiCard label="Avg Chronic Reviews / Patient" value={data.kpis.avgChronicReviewsPerPatient.toFixed(2)} />
      </div>

      <Statistics data={data} />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card"><p className="section-title">Top Risk Carriers</p><BarRank data={data.distributions.riskCarriers} color="var(--accent)" /></section>
        <section className="card"><p className="section-title">Top Doctors</p><BarRank data={data.distributions.doctors} color="var(--scans)" kind="doctor" /></section>
        <section className="card"><p className="section-title">Top Diseases</p><BarRank data={data.distributions.diseases} color="var(--danger)" kind="disease" /></section>
        <section className="card"><p className="section-title">Top Medications</p><BarRank data={data.distributions.medications} color="var(--labs)" kind="drug" /></section>
        <section className="card"><p className="section-title">Top Consultants</p><BarRank data={data.distributions.consultants} color="var(--warning)" /></section>
      </div>

      <PatientTable data={data} />
    </section>
  );
}
