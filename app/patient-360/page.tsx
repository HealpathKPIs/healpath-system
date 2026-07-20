import AnimatedNumber from '@/components/AnimatedNumber';
import { getPatient360, getRiskCarrierOptions, type Patient360Summary } from '@/lib/queries';
import Patient360Client from './Patient360Client';

const inputStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '0 10px',
  font: 'inherit',
  fontSize: 13,
  minWidth: 240,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  minWidth: 190,
};

function displayValue(value: string | number | null) {
  if (value === null || value === '') return 'None';
  return typeof value === 'number' ? value.toLocaleString() : value;
}

function SummaryCard({ label, value }: { label: string; value: string | number | null }) {
  const isText = typeof value === 'string' || value === null;
  return (
    <article className="card kpi-card">
      <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value" style={{ fontSize: isText ? 24 : undefined, lineHeight: 1.05, overflowWrap: 'anywhere' }}>
          {typeof value === 'number' ? <AnimatedNumber value={displayValue(value)} /> : displayValue(value)}
        </div>
      </div>
    </article>
  );
}

function SummaryCards({ summary }: { summary: Patient360Summary }) {
  const cards = [
    ['First Acute Visit', summary.firstAcuteVisit],
    ['Latest Acute Visit', summary.latestAcuteVisit],
    ['Acute Visits', summary.acuteVisits],
    ['Chronic Reviews', summary.chronicReviews],
    ['Doctors Seen', summary.doctorsSeen],
    ['Diagnoses', summary.diagnoses],
    ['Medications', summary.medications],
    ['Labs', summary.labs],
    ['Scans', summary.scans],
  ] as const;
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <p className="section-title" style={{ margin: 0 }}>Patient Summary</p>
      <div className="grid kpirow">
        {cards.map(([label, value]) => <SummaryCard key={label} label={label} value={value} />)}
      </div>
    </section>
  );
}

function PatientInformation({ summary }: { summary: Patient360Summary }) {
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <p className="section-title" style={{ margin: 0 }}>Patient Information</p>
      <div className="grid kpirow">
        <SummaryCard label="Patient ID" value={summary.patientId} />
        <SummaryCard label="Risk Carrier" value={summary.risk_carrier ?? 'Unknown'} />
      </div>
    </section>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <section className="card">
      <p className="section-title">Patient 360</p>
      <div className="chart-empty">
        {query ? `No patient matched Patient ID "${query}".` : 'Search a Patient ID to load the Patient 360 view.'}
      </div>
    </section>
  );
}

export default async function Patient360Page({ searchParams }: {
  searchParams: { patient?: string; riskCarrier?: string };
}) {
  const data = await getPatient360({ patient: searchParams.patient });
  const riskCarriers = await getRiskCarrierOptions();
  const query = data.filters.patient ?? '';

  return (
    <section style={{ display: 'grid', gap: 22, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Patient 360</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Unified acute and chronic read-only patient view.</p>
        </div>
      </div>

      <form className="filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>Patient ID Search</span>
          <input name="patient" defaultValue={query} placeholder="Patient ID" style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>Risk Carrier</span>
          <select name="riskCarrier" defaultValue={searchParams.riskCarrier ?? ''} style={selectStyle}>
            <option value="">All</option>
            {riskCarriers.map((carrier) => <option key={carrier} value={carrier}>{carrier}</option>)}
          </select>
        </label>
        <button type="submit" style={{ height: 38, border: 0, borderRadius: 10, padding: '0 16px', background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Search</button>
        <a href="/patient-360" style={{ height: 38, display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '0 14px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700 }}>Clear</a>
      </form>

      {data.found && data.summary ? (
        <>
          <PatientInformation summary={data.summary} />
          <SummaryCards summary={data.summary} />
          <Patient360Client data={data} />
        </>
      ) : (
        <EmptyState query={query} />
      )}
    </section>
  );
}
