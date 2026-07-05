import PageHead from '@/components/PageHead';
import BarRank from '@/components/BarRank';
import Donut from '@/components/Donut';
import DataTable from '@/components/DataTable';
import SearchBox from '@/components/SearchBox';
import { getDiseases, getDiseaseDescriptions, resolveFilters } from '@/lib/queries';

export default async function Diseases({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string; sel?: string; selv?: string; q?: string } }) {
  // Diseases page honours a drug cross-filter but not a disease one (it is the disease view).
  const f = resolveFilters(searchParams, { doctor: true, drug: true, disease: false });
  const [blocks, descriptions] = await Promise.all([getDiseases(f, 10), getDiseaseDescriptions(f)]);
  return (
    <>
      <PageHead title="Disease & Diagnosis" />
      <div className="grid two" style={{ marginBottom: 18 }}>
        <div className="card">
          <p className="section-title">Diagnoses by ICD block</p>
          <BarRank data={blocks} color="#7f77dd" kind="disease" />
        </div>
        <div className="card">
          <p className="section-title">ICD block share</p>
          <Donut data={blocks.slice(0, 8)} kind="disease" />
        </div>
      </div>
      <div className="card">
        <p className="section-title">Diagnosis drill-down</p>
        <SearchBox scope="diseases" placeholder="Search ICD code or diagnosis…" />
        <DataTable
          rows={descriptions}
          columns={[
            { key: 'label', label: 'ICD description' },
            { key: 'value', label: 'Count', num: true },
          ]} />
      </div>
    </>
  );
}
