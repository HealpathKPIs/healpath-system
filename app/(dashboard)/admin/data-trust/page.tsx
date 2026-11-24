import DataTrustPanel from '@/components/DataTrustPanel';
import { requireAdmin } from '@/lib/auth-server';
import { getDataTrustReport } from '@/lib/data-trust';

export const dynamic = 'force-dynamic';

export default async function DataTrustPage() {
  await requireAdmin();
  const report = await getDataTrustReport();

  return (
    <section style={{ display: 'grid', gap: 20, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead">
        <div>
          <p className="muted" style={{ margin: '0 0 5px', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>Read-only control tower</p>
          <h1 className="pagetitle">Data Trust</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>Aggregate integrity, reconciliation, source, and coverage evidence. No production writes.</p>
        </div>
      </div>
      <DataTrustPanel initialReport={report} />
    </section>
  );
}
