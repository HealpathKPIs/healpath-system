import Link from 'next/link';

import { requireAdmin } from '@/lib/auth-server';
import { getImportBatch } from '@/lib/import-governance';

export const dynamic = 'force-dynamic';

function formatTime(value: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function ImportHistoryDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const batch = await getImportBatch(params.id);
  if (!batch) return <section><h1 className="pagetitle">Import not found</h1><p className="muted">The audit tables may be unavailable or the batch does not exist.</p></section>;
  return (
    <section style={{ display: 'grid', gap: 20, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead"><div>
        <Link href="/admin/import-history" className="muted">← Import history</Link>
        <h1 className="pagetitle" style={{ marginTop: 8 }}>{batch.fileName ?? 'Unnamed import'}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>Status <b>{batch.status}</b> · Reconciliation <b>{batch.reconciliationStatus ?? 'Unknown'}</b> · no patient-level data is displayed.</p>
      </div></div>
      <div className="grid two">
        <div className="card"><p className="section-title">Provenance</p><p className="muted" style={{ lineHeight: 1.8, margin: 0 }}>
          File: <b>{batch.fileName ?? 'Unknown'}</b><br />SHA-256: <b style={{ wordBreak: 'break-all' }}>{batch.fileHash ?? 'Unknown'}</b><br />Size: <b>{batch.fileSizeBytes?.toLocaleString() ?? 'Unknown'} bytes</b><br />Initiated by: <b>{batch.initiatedBy ?? 'Unknown'}</b><br />Started: <b>{formatTime(batch.startedAt)}</b><br />Completed/observed: <b>{formatTime(batch.completedAt)}</b>
        </p></div>
        <div className="card"><p className="section-title">Verification state</p><p style={{ fontWeight: 750, color: batch.status === 'FAILED' ? 'var(--danger)' : 'var(--warning)' }}>{batch.status === 'COMPLETED' ? 'Verified' : batch.status === 'FAILED' ? 'Failed' : 'Unknown / not verified'}</p><p className="muted" style={{ lineHeight: 1.6 }}>{batch.notes ?? 'No notes.'}<br />{batch.errorSummary ?? 'No error summary recorded.'}</p></div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}><p className="section-title">Aggregate reconciliation</p><table className="table" style={{ width: '100%' }}><thead><tr><th>Table</th><th>Before</th><th>After</th><th>Delta</th><th>Inserted</th><th>Updated</th><th>Unchanged</th><th>Rejected</th><th>Status</th></tr></thead><tbody>{batch.metrics.map((metric) => <tr key={metric.tableName}><td>{metric.tableName}</td><td className="num">{metric.rowsBefore?.toLocaleString() ?? 'Unknown'}</td><td className="num">{metric.rowsAfter?.toLocaleString() ?? 'Unknown'}</td><td className="num">{typeof metric.metrics.delta === 'number' ? metric.metrics.delta.toLocaleString() : 'Unknown'}</td><td className="num">{metric.insertedCount ?? 'Unknown'}</td><td className="num">{metric.updatedCount ?? 'Unknown'}</td><td className="num">{metric.unchangedCount ?? 'Unknown'}</td><td className="num">{metric.rejectedCount ?? 'Unknown'}</td><td>{metric.validationStatus}</td></tr>)}</tbody></table></div>
      <div className="card"><p className="section-title">Events</p><ul>{batch.events.map((event) => <li key={event.id}><b>{event.eventType}</b> · {formatTime(event.eventTime)} — {event.message}</li>)}</ul></div>
    </section>
  );
}
