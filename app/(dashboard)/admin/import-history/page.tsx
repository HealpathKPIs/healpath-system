import ImportHistoryPanel from '@/components/ImportHistoryPanel';
import { requireAdmin } from '@/lib/auth-server';
import { listImportBatches } from '@/lib/import-governance';

export const dynamic = 'force-dynamic';

export default async function ImportHistoryPage() {
  await requireAdmin();
  const history = await listImportBatches(100);
  return (
    <section style={{ display: 'grid', gap: 20, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead"><div>
        <p className="muted" style={{ margin: '0 0 5px', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>Governance ledger</p>
        <h1 className="pagetitle">Import History</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>Durable aggregate audit observations. The trusted importer remains unchanged and is never invoked here.</p>
      </div></div>
      <ImportHistoryPanel initial={history} />
    </section>
  );
}
