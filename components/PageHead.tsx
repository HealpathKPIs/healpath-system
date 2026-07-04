import { Suspense } from 'react';
import FilterBar from './FilterBar';
import { listMonths, listSpecialties, listDoctors } from '@/lib/queries';

export default function PageHead({ title, filters = true }: { title: string; filters?: boolean }) {
  return (
    <div className="pagehead">
      <h1 className="pagetitle">{title}</h1>
      {filters && (
        <Suspense fallback={<div className="filters"><div className="skeleton-line" style={{ width: 150, height: 28 }} /><div className="skeleton-line" style={{ width: 150, height: 28 }} /></div>}>
          <FilterBar months={listMonths()} specialties={listSpecialties()} doctors={listDoctors()} />
        </Suspense>
      )}
    </div>
  );
}
