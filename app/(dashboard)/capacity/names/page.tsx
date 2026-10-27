import { requireAdmin } from '@/lib/auth-server';

import CapacityNamesClient from './CapacityNamesClient';

export const dynamic = 'force-dynamic';

export default async function CapacityNames() {
  await requireAdmin();

  return (
    <>
      <div className="pagehead">
        <h1 className="pagetitle">Match doctor names</h1>
      </div>
      <CapacityNamesClient />
    </>
  );
}
