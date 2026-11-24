// Post-import cache invalidation — the single place that knows everything a
// successful import has to expire.
//
// Every import route (acute, chronic, patient master) calls this the moment the
// database write commits, so the next render already sees the new data. Without
// it the dashboard kept serving pre-import values until the server restarted:
//   1. the filter enumerations were memoised in module scope (months, doctors,
//      specialties, risk carriers) — invalidateFilterOptions() drops them;
//   2. Next.js keeps a server-side Router/Data cache per route —
//      revalidatePath('/', 'layout') expires every route under the root layout,
//      which covers Overview, Performance, Pharmacy, Disease, Labs & Scans,
//      Trends, Chronic, Patient Explorer and Patient 360 in one call.
//
// The client half of the contract lives in the import pages: they call
// router.refresh() on success, which re-fetches the current route and drops the
// browser's Router Cache, so no F5 is ever required.

import { revalidatePath } from 'next/cache';
import { invalidateFilterOptions } from './queries';
import { invalidateQueryCache } from './query-cache';

export function invalidateDashboardData(): void {
  invalidateFilterOptions();
  // The measure reads (KPIs, trends, rankings, diagnostics) are memoised for a
  // short TTL by lib/query-cache. Dropping them here is what makes an import
  // visible on the very next render instead of up to one TTL later, and it is
  // the same contract the enumeration cache above already follows.
  invalidateQueryCache();
  try {
    revalidatePath('/', 'layout');
  } catch (e) {
    // revalidatePath throws outside a request/render scope (e.g. the CLI
    // importer). The enumeration cache is already dropped, and the TTL bounds
    // any remaining staleness, so this must never fail an otherwise good import.
    console.warn('revalidatePath after import failed:', (e as Error).message);
  }
}
