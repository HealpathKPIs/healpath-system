import { Suspense } from 'react';
import FilterBar from './FilterBar';
import { listMonths, listSpecialties, listDoctors } from '@/lib/queries';

export default function PageHead({ title, filters = true, months }: { title: string; filters?: boolean; months?: string[] }) {
  const filterMonths = months?.length ? months : listMonths();
  return (
    <div className="pagehead">
      <h1 className="pagetitle">{title}</h1>
      {filters && (
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={filterMonths} specialties={listSpecialties()} doctors={listDoctors()} />
        </Suspense>
      )}
    </div>
  );
}
