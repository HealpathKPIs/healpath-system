import { requireAdmin } from '@/lib/auth-server';

import CapacityImportClient from './CapacityImportClient';

export const dynamic = 'force-dynamic';

export default async function CapacityImport() {
  // Middleware already blocks this path for viewers via ADMIN_ONLY_PATHS; this
  // is the second lock, so the page cannot be reached if that list is edited.
  await requireAdmin();

  return (
    <>
      <div className="pagehead">
        <h1 className="pagetitle">Capacity import</h1>
      </div>
      <CapacityImportClient />
    </>
  );
}
