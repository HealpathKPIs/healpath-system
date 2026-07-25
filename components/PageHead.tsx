import { Suspense } from 'react';
import FilterBar from './FilterBar';
import DataSourceStatus, { DataSourceBadge } from './DataSourceStatus';
import { type CascadeSelection, getCascadingFilterOptions } from '@/lib/queries';

export default async function PageHead({
  title,
  filters = true,
  months,
  selection = {},
}: {
  title: string;
  filters?: boolean;
  months?: string[];
  /** Current filter selection, so the dropdowns below it can cascade. */
  selection?: CascadeSelection;
}) {
  // The dropdowns are always driven by the live enumeration so a newly imported
  // month shows up on every page; the caller's `months` (usually the months its
  // charts plot) is only a fallback for when the database cannot be enumerated.
  const options = filters ? await getCascadingFilterOptions(selection) : null;
  const filterMonths = options?.months.length ? options.months : months ?? [];
  return (
    <>
      {/* Warns (and keeps retrying) whenever this page did not render from the
          live database. Renders nothing when the data is live. */}
      <DataSourceStatus />
      <div className="pagehead">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 className="pagetitle">{title}</h1>
          <DataSourceBadge />
        </div>
        {filters && options && (
          <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
            <FilterBar months={filterMonths} monthsLive={options.months.length > 0} specialties={options.specialties} doctors={options.doctors} riskCarriers={options.riskCarriers} />
          </Suspense>
        )}
      </div>
    </>
  );
}
