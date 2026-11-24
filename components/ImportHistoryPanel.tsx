'use client';

import Link from 'next/link';
import type { ImportBatchSummary } from '@/lib/import-governance';

function formatTime(value: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default function ImportHistoryPanel({ initial }: { initial: { available: boolean; batches: ImportBatchSummary[] } }) {
  if (!initial.available) return <div className="card"><b>Audit tables unavailable</b><p className="muted">The additive governance migration has not been applied in this environment. No importer behavior is affected.</p></div>;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table className="table" style={{ width: '100%' }}>
        <thead><tr><th>Started</th><th>File</th><th>Fingerprint</th><th>Initiated by</th><th>Status</th><th>Reconciliation</th></tr></thead>
        <tbody>{initial.batches.map((batch) => (
          <tr key={batch.id}>
            <td><Link href={`/admin/import-history/${batch.id}`}>{formatTime(batch.startedAt ?? batch.createdAt)}</Link></td>
            <td>{batch.fileName ?? 'Unknown'}</td>
            <td className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{batch.fileHash ? `${batch.fileHash.slice(0, 12)}…` : 'Unknown'}</td>
            <td>{batch.initiatedBy ?? 'Unknown'}</td>
            <td><b>{batch.status}</b></td>
            <td>{batch.reconciliationStatus ?? 'Unknown'}</td>
          </tr>
        ))}</tbody>
      </table>
      {!initial.batches.length && <p className="muted">No governance observations recorded.</p>}
    </div>
  );
}
