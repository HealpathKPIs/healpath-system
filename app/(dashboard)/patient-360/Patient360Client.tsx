'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type {
  Patient360AcuteMedicationRow,
  Patient360AcuteVisit,
  Patient360ChronicMedicationRow,
  Patient360ChronicReview,
  Patient360Data,
  Patient360DiagnosticItem,
  Patient360Medication,
  Patient360Diagnosis,
} from '@/lib/queries';

type TabKey = 'overview' | 'timeline' | 'acute' | 'chronic' | 'medications' | 'issues';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'acute', label: 'Acute' },
  { key: 'chronic', label: 'Chronic' },
  { key: 'medications', label: 'Medication History' },
  { key: 'issues', label: 'Issues' },
];

function formatNumber(value: number) {
  return value.toLocaleString();
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="chart-empty" style={{ minHeight: 160 }}>{children}</div>;
}

function CountCell({ value }: { value: number }) {
  return <td className="num">{formatNumber(value)}</td>;
}

function DetailList<T>({ title, rows, render }: { title: string; rows: T[]; render: (row: T, index: number) => ReactNode }) {
  return (
    <div className="patient360-detail-block">
      <b>{title}</b>
      {rows.length ? (
        <div className="patient360-chip-list">
          {rows.map(render)}
        </div>
      ) : (
        <span className="muted">No rows</span>
      )}
    </div>
  );
}

function AcuteDetails({ visit }: { visit: Patient360AcuteVisit }) {
  return (
    <div className="patient360-expand-grid">
      <DetailList<Patient360Diagnosis>
        title="Diagnoses"
        rows={visit.diagnoses}
        render={(row, index) => (
          <span key={`${row.icdBlock}-${row.icdDesc}-${index}`} className="patient360-chip" title={row.disease}>
            {row.icdBlock} - {row.icdDesc}
          </span>
        )}
      />
      <DetailList<Patient360Medication>
        title="Medications"
        rows={visit.medications}
        render={(row, index) => (
          <span key={`${row.brand}-${row.activeIngredient}-${index}`} className="patient360-chip" title={row.medication}>
            {row.brand} - {row.activeIngredient}
          </span>
        )}
      />
      <DetailList<Patient360DiagnosticItem>
        title="Labs"
        rows={visit.labs}
        render={(row, index) => <span key={`${row.test}-${index}`} className="patient360-chip">{row.test}</span>}
      />
      <DetailList<Patient360DiagnosticItem>
        title="Scans"
        rows={visit.scans}
        render={(row, index) => <span key={`${row.test}-${index}`} className="patient360-chip">{row.test}</span>}
      />
    </div>
  );
}

function ChronicDetails({ review }: { review: Patient360ChronicReview }) {
  return (
    <div className="patient360-expand-grid">
      <DetailList<string>
        title="Recommendations"
        rows={review.recommendations}
        render={(row) => <span key={row} className="patient360-chip">{row}</span>}
      />
      <DetailList<string>
        title="Issues"
        rows={review.issues}
        render={(row) => <span key={row} className="patient360-chip">{row}</span>}
      />
    </div>
  );
}

function Overview({ data }: { data: Patient360Data }) {
  const summary = data.summary;
  if (!summary) return <Empty>No patient summary loaded.</Empty>;
  const cards = [
    { label: 'Acute Visits', value: summary.acuteVisits },
    { label: 'Chronic Reviews', value: summary.chronicReviews },
    { label: 'Doctors Seen', value: summary.doctorsSeen },
    { label: 'Diagnoses', value: summary.diagnoses },
    { label: 'Medications', value: summary.medications },
  ];
  return (
    <div className="grid kpirow">
      {cards.map((card) => (
        <article key={card.label} className="card kpi-card">
          <div className="kpi-label">{card.label}</div>
          <div className="kpi-value">{formatNumber(card.value)}</div>
        </article>
      ))}
    </div>
  );
}

function Timeline({ data }: { data: Patient360Data }) {
  if (!data.timeline.length) return <Empty>No acute or chronic events for this patient.</Empty>;
  return (
    <section className="card">
      <p className="section-title">Unified Timeline</p>
      <div className="patient360-timeline">
        {data.timeline.map((event) => (
          <div key={`${event.type}-${event.id}`} className="patient360-timeline-row">
            <span className="patient360-dot" aria-hidden="true" />
            <div>
              <b>{event.type === 'acute' ? event.date : `${event.period} / ${event.week}`}</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {event.type === 'acute'
                  ? `Visit - ${event.doctor} - Diagnoses ${event.diagnosisCount.toLocaleString()} - Medications ${event.medicationCount.toLocaleString()}`
                  : `Chronic - ${event.phase.toUpperCase()} - Recommendations ${event.recommendationCount.toLocaleString()} - Issues ${event.issueCount.toLocaleString()}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AcuteTable({ rows }: { rows: Patient360AcuteVisit[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>No Acute visits</Empty>;
  return (
    <section className="card">
      <p className="section-title">Acute Visits</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Visit Date</th>
              <th>Doctor</th>
              <th>Specialty</th>
              <th className="num">Diagnosis Count</th>
              <th className="num">Medication Count</th>
              <th className="num">Labs Count</th>
              <th className="num">Scans Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((visit) => (
              <Fragment key={visit.visitId}>
                <tr>
                  <td>
                    <button type="button" className="patient360-row-button" onClick={() => setOpen((value) => value === visit.visitId ? null : visit.visitId)}>
                      {open === visit.visitId ? 'Hide' : 'Show'} {visit.visitDate}
                    </button>
                  </td>
                  <td>{visit.doctor}</td>
                  <td>{visit.specialty}</td>
                  <CountCell value={visit.diagnosisCount} />
                  <CountCell value={visit.medicationCount} />
                  <CountCell value={visit.labsCount} />
                  <CountCell value={visit.scansCount} />
                </tr>
                {open === visit.visitId ? (
                  <tr>
                    <td colSpan={7} className="patient360-expanded-cell"><AcuteDetails visit={visit} /></td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChronicTable({ rows }: { rows: Patient360ChronicReview[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>No Chronic reviews</Empty>;
  return (
    <section className="card">
      <p className="section-title">Chronic Reviews</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Period</th>
              <th>PRE / POST</th>
              <th className="num">Recommendation Count</th>
              <th className="num">Issue Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((review) => (
              <Fragment key={review.id}>
                <tr>
                  <td>
                    <button type="button" className="patient360-row-button" onClick={() => setOpen((value) => value === review.id ? null : review.id)}>
                      {open === review.id ? 'Hide' : 'Show'} {review.week}
                    </button>
                  </td>
                  <td>{review.period}</td>
                  <td>{review.phase.toUpperCase()}</td>
                  <CountCell value={review.recommendationCount} />
                  <CountCell value={review.issueCount} />
                </tr>
                {open === review.id ? (
                  <tr>
                    <td colSpan={5} className="patient360-expanded-cell"><ChronicDetails review={review} /></td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceBadge({ source }: { source: 'Acute' | 'Chronic' }) {
  return <span className="patient360-chip" style={{ fontWeight: 800 }}>{source}</span>;
}

// Acute medications — every drug_fact row, newest visit first.
function AcuteMedicationTable({ rows }: { rows: Patient360AcuteMedicationRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>No Acute medications</Empty>;
  return (
    <section className="card">
      <p className="section-title">Acute Medications</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Visit Date</th>
              <th>Medication</th>
              <th>Active Ingredient</th>
              <th>Brand</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td>
                    <button type="button" className="patient360-row-button" onClick={() => setOpen((value) => value === row.id ? null : row.id)}>
                      {open === row.id ? 'Hide' : 'Show'} {row.visitDate ?? 'Undated'}
                    </button>
                  </td>
                  <td>{row.medication}</td>
                  <td>{row.activeIngredient || '-'}</td>
                  <td>{row.brand || '-'}</td>
                  <td><SourceBadge source="Acute" /></td>
                </tr>
                {open === row.id ? (
                  <tr>
                    <td colSpan={5} className="patient360-expanded-cell">
                      <div className="patient360-expand-grid">
                        <DetailList<string>
                          title="Medication"
                          rows={[row.medication]}
                          render={(value) => <span key={value} className="patient360-chip">{value}</span>}
                        />
                        <DetailList<string>
                          title="Details"
                          rows={[row.activeIngredient ? `Active ingredient: ${row.activeIngredient}` : '', row.brand ? `Brand: ${row.brand}` : ''].filter(Boolean)}
                          render={(value) => <span key={value} className="patient360-chip">{value}</span>}
                        />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Chronic medications — every Pre/Post review row exactly as stored (no
// aggregation, no deduplication), newest week first, with its recommendation.
function ChronicMedicationTable({ rows }: { rows: Patient360ChronicMedicationRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>No Chronic medications</Empty>;
  return (
    <section className="card">
      <p className="section-title">Chronic Medications</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>PRE / POST</th>
              <th>Medication</th>
              <th>Recommendation</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td>
                    <button type="button" className="patient360-row-button" onClick={() => setOpen((value) => value === row.id ? null : row.id)}>
                      {open === row.id ? 'Hide' : 'Show'} {row.week}
                    </button>
                  </td>
                  <td>{row.phase.toUpperCase()}</td>
                  <td>{row.medication}</td>
                  <td>{row.recommendation}</td>
                  <td><SourceBadge source="Chronic" /></td>
                </tr>
                {open === row.id ? (
                  <tr>
                    <td colSpan={5} className="patient360-expanded-cell">
                      <div className="patient360-expand-grid">
                        <DetailList<string>
                          title={`Week ${row.week} | ${row.phase.toUpperCase()} (${row.period})`}
                          rows={[row.medication]}
                          render={(value) => <span key={value} className="patient360-chip">{value}</span>}
                        />
                        <DetailList<string>
                          title="Recommendation"
                          rows={[row.recommendation]}
                          render={(value) => <span key={value} className="patient360-chip">{value}</span>}
                        />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MedicationHistory({ data }: { data: Patient360Data }) {
  const { acute, chronic } = data.medicationHistory;
  if (!acute.length && !chronic.length) return <Empty>No medications for this patient.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <AcuteMedicationTable rows={acute} />
      <ChronicMedicationTable rows={chronic} />
    </div>
  );
}

function Issues({ data }: { data: Patient360Data }) {
  if (!data.issueCatalog.length) return <Empty>No configured issue catalog rows.</Empty>;
  return (
    <section className="card">
      <p className="section-title">Fixed Issue Catalog</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Issue</th>
              <th className="num">PRE</th>
              <th className="num">POST</th>
              <th className="num">Difference</th>
              <th className="num">Improvement %</th>
            </tr>
          </thead>
          <tbody>
            {data.issueCatalog.map((row) => (
              <tr key={row.issue}>
                <td>{row.issue}</td>
                <CountCell value={row.pre} />
                <CountCell value={row.post} />
                <td className="num">{row.difference.toLocaleString()}</td>
                <td className="num" style={{ color: row.improvementPct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 850 }}>
                  {row.improvementPct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Patient360Client({ data }: { data: Patient360Data }) {
  const [tab, setTab] = useState<TabKey>('overview');
  return (
    <div className="patient360-tabs">
      <div className="patient360-tab-list" role="tablist" aria-label="Patient 360 views">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className="patient360-tab"
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' ? <Overview data={data} /> : null}
        {tab === 'timeline' ? <Timeline data={data} /> : null}
        {tab === 'acute' ? <AcuteTable rows={data.acuteVisits} /> : null}
        {tab === 'chronic' ? <ChronicTable rows={data.chronicReviews} /> : null}
        {tab === 'medications' ? <MedicationHistory data={data} /> : null}
        {tab === 'issues' ? <Issues data={data} /> : null}
      </div>
    </div>
  );
}
