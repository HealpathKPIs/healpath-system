'use client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { RankRow } from '@/lib/types';
import { useDashboard, type SelectionType } from '@/lib/dashboard-context';

const COLORS = ['#635bff', '#16a36f', '#2563eb', '#d97706', '#d92d20', '#db2777', '#0d9488', '#ea580c', '#64748b', '#65a30d'];

export default function Donut({ data, kind }: { data: RankRow[]; kind?: SelectionType }) {
  const { selection, select, clear } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function toggle(value: string) {
    if (!kind) return;
    const active = (selection?.type === kind && selection?.value === value) ||
      (params.get('sel') === kind && params.get('selv') === value);
    const next = new URLSearchParams(params.toString());
    if (active) { clear(); next.delete('sel'); next.delete('selv'); }
    else { select(kind, value); next.set('sel', kind); next.set('selv', value); }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  if (!data.length) {
    return <div className="chart-empty">No share data for the selected filters</div>;
  }

  return (
    <div data-export-chart="recharts">
      <ResponsiveContainer width="100%" height={310}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="48%"
            innerRadius={66}
            outerRadius={104}
            paddingAngle={2}
            onClick={kind ? (_, index) => { const row = data[index]; if (row) toggle(row.label); } : undefined}
          >
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #e4e7ec',
              borderRadius: 8,
              color: '#111827',
              boxShadow: '0 12px 30px rgba(16,24,40,.12)',
            }}
            itemStyle={{ color: '#111827', fontWeight: 700 }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#667085', paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
