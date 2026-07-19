import AnimatedNumber from '@/components/AnimatedNumber';
import {
  getChronicPatientExplorer,
  type ChronicPatientChange,
  type ChronicPatientHistoryItem,
  type ChronicPatientTimelineRow,
  type ChronicPatientWeekHistory,
} from '@/lib/queries';
import Link from 'next/link';

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

const cellStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '11px 8px',
  borderBottom: '1px solid var(--border-soft)',
  fontVariantNumeric: 'tabular-nums',
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function SummaryCard({ label, pre, post, difference }: { label: string; pre: number; post: number; difference: number }) {
  const tone = difference < 0 ? 'var(--success)' : difference > 0 ? 'var(--danger)' : 'var(--text-muted)';
  return (
    <section className="card kpi-card">
      <div style={{ display: 'grid', gap: 14, width: '100%' }}>
        <div className="kpi-label">{label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>PRE</div>
            <div className="kpi-value" style={{ fontSize: 30, lineHeight: 1 }}><AnimatedNumber value={formatNumber(pre)} /></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>POST</div>
            <div className="kpi-value" style={{ fontSize: 30, lineHeight: 1 }}><AnimatedNumber value={formatNumber(post)} /></div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
          <span className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>Difference</span>
          <div style={{ color: tone, fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{difference.toLocaleString()}</div>
        </div>
      </div>
    </section>
  );
}

function PatientIdentityCard({ patientId, weeks }: { patientId: string; weeks: number }) {
  return (
    <section className="card kpi-card">
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="kpi-label">Patient ID</div>
        <div className="kpi-value" style={{ fontSize: 30, lineHeight: 1, overflowWrap: 'anywhere' }}>{patientId}</div>
        <div className="muted" style={{ fontWeight: 800 }}>{weeks.toLocaleString()} week{weeks === 1 ? '' : 's'} in history</div>
      </div>
    </section>
  );
}

function MatchList({ matches, query }: { matches: string[]; query: string }) {
  if (!query) {
    return (
      <section className="card">
        <p className="section-title">Patient Explorer</p>
        <div className="chart-empty">Search a Patient ID to view PRE to POST chronic history.</div>
      </section>
    );
  }
  if (!matches.length) {
    return (
      <section className="card">
        <p className="section-title">Patient Explorer</p>
        <div className="chart-empty">No chronic patient matched "{query}".</div>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="section-title">Select Patient</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {matches.map((match) => (
          <Link key={match} href={`/chronic/patient?patient=${encodeURIComponent(match)}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, border: '1px solid var(--border)', borderRadius: 8, padding: '11px 12px', color: 'var(--text)', textDecoration: 'none', fontWeight: 800 }}>
            <span>{match}</span>
            <span className="muted">Open</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Timeline({ rows }: { rows: ChronicPatientTimelineRow[] }) {
  const weeks = Array.from(new Set(rows.map((row) => `${row.period}\u0000${row.week}`)))
    .map((key) => {
      const [period, week] = key.split('\u0000');
      return { period, week, pre: rows.filter((row) => row.week === week && row.phase === 'pre'), post: rows.filter((row) => row.week === week && row.phase === 'post') };
    })
    .sort((a, b) => a.week.localeCompare(b.week, undefined, { numeric: true }));
  return (
    <section className="card">
      <p className="section-title">Timeline</p>
      <div style={{ display: 'grid', gap: 12 }}>
        {weeks.map((week) => (
          <div key={`${week.period}-${week.week}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <b>{week.period}</b>
              <span className="muted" style={{ fontWeight: 800 }}>{week.week}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 32px minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
              <PhaseList title="PRE" rows={week.pre} />
              <div className="muted" style={{ textAlign: 'center', fontWeight: 900, paddingTop: 28 }}>to</div>
              <PhaseList title="POST" rows={week.post} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PhaseList({ title, rows }: { title: string; rows: ChronicPatientTimelineRow[] }) {
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em', color: 'var(--text-soft)' }}>{title}</span>
      {rows.length ? rows.map((row, index) => (
        <div key={`${row.phase}-${row.week}-${row.medicationName}-${index}`} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--surface-2)', padding: 10 }}>
          <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.medicationName}>{row.medicationName}</b>
          {row.recommendation ? <div className="muted" style={{ marginTop: 5 }}>{row.recommendation}</div> : null}
          {row.issues.length ? <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>{row.issues.map((issue) => <span key={issue} className="rank-value">{issue}</span>)}</div> : null}
        </div>
      )) : <div className="chart-empty" style={{ minHeight: 72 }}>No rows</div>}
    </div>
  );
}

function MedicationChanges({ rows }: { rows: ChronicPatientChange[] }) {
  return (
    <section className="card">
      <p className="section-title">Medication Changes</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Medication', 'PRE', 'POST', 'Difference', 'Status'].map((header, index) => (
                <th key={header} style={{ textAlign: index === 0 || index === 4 ? 'left' : 'right', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.label}</td>
                <td style={cellStyle}>{row.pre.toLocaleString()}</td>
                <td style={cellStyle}>{row.post.toLocaleString()}</td>
                <td style={cellStyle}>{row.difference.toLocaleString()}</td>
                <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 850 }}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryTable({ title, rows }: { title: string; rows: ChronicPatientHistoryItem[] }) {
  return (
    <section className="card">
      <p className="section-title">{title}</p>
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Item', 'PRE', 'POST', 'Total', 'Weeks'].map((header, index) => (
                  <th key={header} style={{ textAlign: index === 0 || index === 4 ? 'left' : 'right', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.label}</td>
                  <td style={cellStyle}>{row.pre.toLocaleString()}</td>
                  <td style={cellStyle}>{row.post.toLocaleString()}</td>
                  <td style={cellStyle}>{row.total.toLocaleString()}</td>
                  <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>{row.weeks.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="chart-empty">No history for this patient</div>}
    </section>
  );
}

function WeekHistory({ rows }: { rows: ChronicPatientWeekHistory[] }) {
  return (
    <section className="card">
      <p className="section-title">Week History</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Period', 'Week', 'PRE Meds', 'POST Meds', 'PRE Issues', 'POST Issues', 'PRE Recs', 'POST Recs'].map((header, index) => (
                <th key={header} style={{ textAlign: index < 2 ? 'left' : 'right', padding: '10px 8px', color: 'var(--text-soft)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-2)' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.period}-${row.week}`}>
                <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)', fontWeight: 750 }}>{row.period}</td>
                <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--border-soft)' }}>{row.week}</td>
                <td style={cellStyle}>{row.preMedications.toLocaleString()}</td>
                <td style={cellStyle}>{row.postMedications.toLocaleString()}</td>
                <td style={cellStyle}>{row.preIssues.toLocaleString()}</td>
                <td style={cellStyle}>{row.postIssues.toLocaleString()}</td>
                <td style={cellStyle}>{row.preRecommendations.toLocaleString()}</td>
                <td style={cellStyle}>{row.postRecommendations.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ChronicPatientPage({ searchParams }: {
  searchParams: { patient?: string };
}) {
  const data = await getChronicPatientExplorer({ patient: searchParams.patient });
  const query = data.filters.patient ?? '';

  return (
    <section style={{ display: 'grid', gap: 22 }}>
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Patient Explorer</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Read-only PRE to POST chronic history by Patient ID.</p>
        </div>
        <Link
          href="/chronic"
          style={{
            height: 38,
            display: 'inline-flex',
            alignItems: 'center',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '0 14px',
            color: 'var(--text)',
            background: 'var(--surface)',
            textDecoration: 'none',
            fontWeight: 800,
            boxShadow: 'var(--shadow-xs)',
          }}
        >
          Overview
        </Link>
      </div>

      <form className="filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>Patient ID</span>
          <input name="patient" defaultValue={query} placeholder="Search Patient ID" style={inputStyle} />
        </label>
        <button type="submit" style={{ height: 38, border: 0, borderRadius: 10, padding: '0 16px', background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Search</button>
        <a href="/chronic/patient" style={{ height: 38, display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '0 14px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700 }}>Clear</a>
      </form>

      {!data.selectedPatientId ? (
        <MatchList matches={data.matches} query={query} />
      ) : (
        <>
          {data.summary ? (
            <div className="grid kpirow">
              <PatientIdentityCard patientId={data.summary.patientId} weeks={data.summary.weeks} />
              <SummaryCard label="Medications" pre={data.summary.preMedications} post={data.summary.postMedications} difference={data.summary.medicationDifference} />
              <SummaryCard label="Issues" pre={data.summary.preIssues} post={data.summary.postIssues} difference={data.summary.issueDifference} />
              <SummaryCard label="Recommendations" pre={data.summary.preRecommendations} post={data.summary.postRecommendations} difference={data.summary.recommendationDifference} />
            </div>
          ) : null}

          <Timeline rows={data.timeline} />
          <MedicationChanges rows={data.medicationChanges} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <HistoryTable title="Issue History" rows={data.issueHistory} />
            <HistoryTable title="Recommendation History" rows={data.recommendationHistory} />
          </div>
          <WeekHistory rows={data.weekHistory} />
        </>
      )}
    </section>
  );
}
