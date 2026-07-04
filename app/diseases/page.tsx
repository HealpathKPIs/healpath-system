import PageHead from '@/components/PageHead';
import BarRank from '@/components/BarRank';
import Donut from '@/components/Donut';
import DataTable from '@/components/DataTable';
import { getDiseases, getDiseaseDescriptions } from '@/lib/queries';

export default async function Diseases({ searchParams }: { searchParams: { month?: string; specialty?: string; doctor?: string } }) {
  const f = { month: searchParams.month ?? null, specialty: searchParams.specialty ?? null, doctor: searchParams.doctor ?? null };
  const [blocks, descriptions] = await Promise.all([getDiseases(f, 10), getDiseaseDescriptions(f)]);
  return (
    <>
      <PageHead title="Disease & Diagnosis" />
      <div className="grid two" style={{ marginBottom: 18 }}>
        <div className="card">
          <p className="section-title">Diagnoses by ICD block</p>
          <BarRank data={blocks} color="#7f77dd" />
        </div>
        <div className="card">
          <p className="section-title">ICD block share</p>
          <Donut data={blocks.slice(0, 8)} />
        </div>
      </div>
      <div className="card">
        <p className="section-title">Diagnosis drill-down</p>
        <DataTable searchable searchKey="label"
          rows={descriptions}
          columns={[
            { key: 'label', label: 'ICD description' },
            { key: 'value', label: 'Count', num: true },
          ]} />
      </div>
    </>
  );
}
