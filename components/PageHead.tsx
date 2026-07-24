import { Suspense } from 'react';
import FilterBar from './FilterBar';
import { getFilterOptions } from '@/lib/queries';

export default async function PageHead({ title, filters = true, months }: { title: string; filters?: boolean; months?: string[] }) {
  // The dropdowns are always driven by the live enumeration so a newly imported
  // month shows up on every page; the caller's `months` (usually the months its
  // charts plot) is only a fallback for when the database cannot be enumerated.
  const options = filters ? await getFilterOptions() : null;
  const filterMonths = options?.months.length ? options.months : months ?? [];
  return (
    <div className="pagehead">
      <h1 className="pagetitle">{title}</h1>
      {filters && options && (
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={filterMonths} monthsLive={options.months.length > 0} specialties={options.specialties} doctors={options.doctors} riskCarriers={options.riskCarriers} />
        </Suspense>
      )}
    </div>
  );
}
