import type { CSSProperties } from 'react';
import type { DataQualityReport, QualityCheck, QualitySeverity } from '@/lib/data-quality';

const card: CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px',
  background: 'var(--surface)', boxShadow: 'var(--shadow-xs)', minWidth: 0,
};

const tone: Record<QualitySeverity, string> = {
  PASS: 'var(--success)', WARNING: 'var(--warning)', CRITICAL: 'var(--danger)', UNKNOWN: 'var(--text-muted)',
};

function value(value: number | string | null) {
  if (value === null) return 'UNKNOWN';
  return typeof value === 'number' ? value.toLocaleString() : value;
}

function Status({ severity }: { severity: QualitySeverity }) {
  return <b style={{ color: tone[severity], fontSize: 12 }}>{severity}</b>;
}

function CheckTable({ checks }: { checks: QualityCheck[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ width: '100%' }}>
        <thead><tr><th>Severity</th><th>Check</th><th className="num">Current</th><th className="num">Baseline</th><th className="num">Difference</th><th>Explanation</th><th>Action</th></tr></thead>
        <tbody>{checks.map((check) => (
          <tr key={check.checkName}>
            <td><Status severity={check.severity} /></td><td>{check.checkName}</td>
            <td className="num">{value(check.currentValue)}</td><td className="num">{value(check.baselineValue)}</td><td className="num">{value(check.difference)}</td>
            <td className="muted" style={{ minWidth: 260 }}>{check.explanation}</td><td>{check.actionRequired ? 'Review required' : 'No automatic action'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function DataQualitySection({ report }: { report: DataQualityReport }) {
  const quality = report.checks.filter((check) => check.category === 'DATA QUALITY');
  const coverage = report.checks.filter((check) => check.category === 'DATA COVERAGE');
  const facts = report.checks.filter((check) => check.category === 'FACT TABLE INTEGRITY');
  const qualityColor = report.qualityOperationalStatus === 'HEALTHY' ? 'var(--success)' : report.qualityOperationalStatus === 'DEGRADED' ? 'var(--warning)' : 'var(--danger)';
  const sourceColor = report.source.source === 'LIVE' ? 'var(--success)' : report.source.source === 'UNAVAILABLE' ? 'var(--danger)' : 'var(--warning)';

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ ...card, borderLeft: `4px solid ${qualityColor}` }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <b>SOURCE: <span style={{ color: sourceColor }}>{report.source.source}</span></b>
          <b>OPERATIONAL: <span style={{ color: report.source.operationalStatus === 'HEALTHY' ? 'var(--success)' : report.source.operationalStatus === 'DEGRADED' ? 'var(--warning)' : 'var(--danger)' }}>{report.source.operationalStatus}</span></b>
          <b>QUALITY: <span style={{ color: qualityColor }}>{report.qualityOperationalStatus}</span></b>
        </div>
        <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
          Database connectivity and data correctness are assessed separately. A WARNING does not automatically mean invalid data. A CRITICAL data-quality finding does not automatically mean KPI calculations are wrong. UNKNOWN means no approved baseline or threshold exists. Anomaly detection never triggers automatic correction.
        </p>
      </div>

      <section style={card}>
        <p className="section-title">DATA COVERAGE</p>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          Reporting scope: <b>{report.reportingScope}</b> · prescription dates <b>{report.coverage.earliestPrescriptionDate ?? 'Unknown'}</b> to <b>{report.coverage.latestPrescriptionDate ?? 'Unknown'}</b> · reporting months <b>{report.coverage.earliestReportingMonth ?? 'Unknown'}</b> to <b>{report.coverage.latestReportingMonth ?? 'Unknown'}</b>
        </p>
        <CheckTable checks={coverage} />
      </section>

      <section style={card}>
        <p className="section-title">DATA QUALITY</p>
        <CheckTable checks={quality} />
      </section>

      <section style={card}>
        <p className="section-title">MONTHLY RECONCILIATION</p>
        <div style={{ overflowX: 'auto' }}><table className="table" style={{ width: '100%' }}>
          <thead><tr><th>Month</th><th className="num">Visits</th><th className="num">Eligible</th><th className="num">Patients</th><th className="num">Doctors</th><th className="num">Specialties</th><th className="num">Diagnosis</th><th className="num">Drug</th><th className="num">Lab</th><th className="num">Scan</th><th>Baseline</th><th className="num">Difference</th></tr></thead>
          <tbody>{report.monthlyReconciliation.map((month) => <tr key={month.month}>
            <td>{month.month}</td><td className="num">{month.totalVisits.toLocaleString()}</td><td className="num">{month.dashboardEligibleVisits.toLocaleString()}</td>
            <td className="num">{month.uniquePatients.toLocaleString()}</td><td className="num">{month.uniqueDoctors.toLocaleString()}</td><td className="num">{month.uniqueSpecialties.toLocaleString()}</td>
            <td className="num">{month.diagnosisRows.toLocaleString()}</td><td className="num">{month.drugRows.toLocaleString()}</td><td className="num">{month.labRows.toLocaleString()}</td><td className="num">{month.scanRows.toLocaleString()}</td>
            <td>{month.baselineStatus}{month.baselineVisits === null ? '' : ` · ${month.baselineVisits.toLocaleString()}`}</td><td className="num">{month.visitDifference === null ? 'UNKNOWN' : month.visitDifference.toLocaleString()}</td>
          </tr>)}</tbody>
        </table></div>
        {!report.monthlyReconciliation.length && <p className="muted">Monthly reconciliation is unavailable.</p>}
      </section>

      <section style={card}>
        <p className="section-title">FACT TABLE INTEGRITY</p>
        <CheckTable checks={facts} />
      </section>

      <section style={card}>
        <p className="section-title">ANOMALIES</p>
        <div style={{ overflowX: 'auto' }}><table className="table" style={{ width: '100%' }}>
          <thead><tr><th>Severity</th><th>Signal</th><th className="num">Current</th><th className="num">Baseline</th><th className="num">Difference</th><th>Rule and explanation</th><th>Action</th></tr></thead>
          <tbody>{report.anomalies.map((anomaly) => <tr key={anomaly.checkName}>
            <td><Status severity={anomaly.severity} /></td><td>{anomaly.checkName}</td><td className="num">{value(anomaly.currentValue)}</td><td className="num">{value(anomaly.baselineValue)}</td><td className="num">{value(anomaly.difference)}</td>
            <td className="muted" style={{ minWidth: 300 }}><b>{anomaly.rule}</b><br />{anomaly.explanation}</td><td>{anomaly.actionRequired ? 'Review required' : 'No automatic action'}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section style={card}>
        <p className="section-title">KNOWN LIMITATIONS</p>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', lineHeight: 1.7 }}>{report.knownLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </section>
    </div>
  );
}
