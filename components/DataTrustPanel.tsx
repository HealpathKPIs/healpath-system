'use client';

import { useState } from 'react';
import type { DataTrustReport } from '@/lib/data-trust';
import DataQualitySection from '@/components/DataQualitySection';

const card: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px',
  background: 'var(--surface)', boxShadow: 'var(--shadow-xs)', minWidth: 0,
};

function formatTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function Count({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div style={card}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 750 }}>{label}</div>
      <div style={{ marginTop: 5, fontSize: 24, fontWeight: 850, color: tone ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

export default function DataTrustPanel({ initialReport }: { initialReport: DataTrustReport }) {
  const [report, setReport] = useState(initialReport);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch('/api/admin/data-trust', { cache: 'no-store' });
      const next = await response.json();
      setReport(next);
    } finally {
      setRefreshing(false);
    }
  }

  const assessment = report.assessment;
  const sourceColor = report.database.reachable ? 'var(--success)' : 'var(--danger)';

  return (
    <>
      <div style={{ ...card, borderLeft: `4px solid ${sourceColor}`, display: 'flex', gap: 14, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <b style={{ color: sourceColor }}>SOURCE: {report.source.source} · OPERATIONAL: {report.source.operationalStatus}</b>
          <div className="muted" style={{ marginTop: 5, fontSize: 13 }}>
            Checked {formatTime(report.checkedAt)} · latency {report.database.latencyMs.toLocaleString()} ms · data through {formatTime(report.freshness.latestPrescriptionDate)}
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="btn-secondary">
          {refreshing ? 'Refreshing…' : 'Refresh read-only checks'}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <Count label="Total database visits" value={report.reconciliation.visits} />
        <Count label="Dashboard-eligible visits" value={report.reconciliation.dashboardEligibleVisits} />
        <Count label="Excluded / outside dashboard scope" value={report.reconciliation.outsideDashboardScope} tone={report.reconciliation.outsideDashboardScope ? 'var(--warning)' : 'var(--success)'} />
        <Count label="Distinct patients" value={report.reconciliation.distinctPatients} />
        <Count label="Duplicate visit IDs" value={report.reconciliation.duplicateVisitIds} tone={report.reconciliation.duplicateVisitIds ? 'var(--danger)' : 'var(--success)'} />
        <Count label="Hard integrity failures" value={assessment?.hardFailures ?? 'Unavailable'} tone={assessment?.hardFailures ? 'var(--danger)' : 'var(--success)'} />
        <Count label="Warnings" value={assessment?.warnings ?? 'Unavailable'} tone={assessment?.warnings ? 'var(--warning)' : 'var(--success)'} />
      </div>

      <DataQualitySection report={report.dataQuality} />

      <div className="grid two">
        <div style={card}>
          <p className="section-title">Coverage and freshness</p>
          <p className="muted" style={{ lineHeight: 1.7, margin: 0 }}>
            Live data range: <b>{formatTime(report.freshness.earliestPrescriptionDate)}</b> to <b>{formatTime(report.freshness.latestPrescriptionDate)}</b><br />
            Latest reporting month: <b>{report.freshness.latestReportingMonth ?? 'Unknown'}</b><br />
            Snapshot version: <b>{report.snapshot?.version ?? 'Unavailable'}</b><br />
            Snapshot generated: <b>{formatTime(report.snapshot?.generatedAt)}</b><br />
            Snapshot age: <b>{report.snapshot?.ageDays ?? 'Unknown'} days</b><br />
            Snapshot coverage: <b>{report.snapshot?.coverage ?? 'Unknown'}</b>
          </p>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>No freshness threshold is applied. Dates and coverage are factual only.</p>
        </div>

        <div style={card}>
          <p className="section-title">Import governance</p>
          {!report.governance.auditTablesAvailable ? <p className="muted">Durable import audit tables are unavailable in this environment. No browser-local history is treated as authoritative.</p> : <p className="muted" style={{ lineHeight: 1.7, margin: 0 }}>
            Latest observation: <b>{report.governance.latestImport?.status ?? 'None recorded'}</b><br />
            Last reconciliation: <b>{report.governance.latestReconciliation?.status ?? 'Unknown'}</b><br />
            Unresolved failed/unknown observations: <b>{report.governance.unresolvedCount.toLocaleString()}</b><br />
            Latest verified data version: <b>{report.governance.latestVerifiedVersion?.latestReportingMonth ?? 'None'}</b>
          </p>}
        </div>
      </div>
    </>
  );
}
