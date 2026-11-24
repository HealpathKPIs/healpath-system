import Link from 'next/link';
import { getCurrentProfile } from '@/lib/auth-server';
import { getDataTrustReport } from '@/lib/data-trust';

function dateOnly(value: string | null) {
  return value ? value.slice(0, 10) : 'unknown';
}

export default async function ExecutiveTrustIndicator() {
  const [report, profile] = await Promise.all([getDataTrustReport(), getCurrentProfile()]);
  const unavailable = !report.database.reachable || !report.assessment;
  const attention = !unavailable && (report.assessment!.hardFailures > 0 || report.assessment!.warnings > 0);
  const color = unavailable ? 'var(--danger)' : attention ? 'var(--warning)' : 'var(--success)';
  const label = unavailable ? 'Unavailable' : attention ? 'Attention' : 'Verified checks';

  return (
    <div style={{ marginBottom: 18, border: `1px solid ${color}`, borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '11px 14px', background: 'var(--surface)', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ color }}>Data Trust: {label}</b>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Source {report.source.source} · data through {dateOnly(report.freshness.latestPrescriptionDate)}
          {report.assessment ? ` · ${report.assessment.hardFailures} hard failures · ${report.assessment.warnings} warnings` : ''}
        </span>
      </div>
      {profile?.role === 'admin' ? <Link href="/admin/data-trust" style={{ color, fontSize: 12.5, fontWeight: 800 }}>View evidence →</Link> : null}
    </div>
  );
}
