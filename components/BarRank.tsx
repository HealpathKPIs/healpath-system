'use client';
import type { RankRow } from '@/lib/types';
import { useDashboard, type SelectionType } from '@/lib/dashboard-context';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export default function BarRank({ data, color = '#635bff', kind }:
  { data: RankRow[]; color?: string; height?: number; kind?: SelectionType }) {
  const { selection, select, clear } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (!data.length) {
    return <div className="chart-empty">No data for the selected filters</div>;
  }

  const max = Math.max(...data.map((row) => row.value), 1);
  const interactive = Boolean(kind);

  // The context drives the pressed visual (Sprint 16); the URL (?sel/?selv) is the
  // transport the server pages read (Sprint 17). Both are kept in sync here.
  function isActive(value: string) {
    if (kind === 'doctor') {
      return params.get('doctor') === value;
    }
    return (selection?.type === kind && selection?.value === value) ||
      (params.get('sel') === kind && params.get('selv') === value);
  }
  function toggle(value: string) {
    const active = isActive(value);
    const next = new URLSearchParams(params.toString());
    const href = () => {
      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    };
    if (kind === 'doctor') {
      next.delete('sel');
      next.delete('selv');
      if (active) {
        clear();
        next.delete('doctor');
      } else {
        select('doctor', value);
        next.set('doctor', value);
      }
      router.push(href(), { scroll: false });
      return;
    }
    if (active) {
      clear();
      next.delete('sel');
      next.delete('selv');
    } else {
      select(kind!, value);
      next.set('sel', kind!);
      next.set('selv', value);
    }
    router.replace(href(), { scroll: false });
  }

  return (
    <div className="rank-list">
      {data.map((row) => {
        const width = `${Math.max(4, (row.value / max) * 100)}%`;
        const selected = interactive && isActive(row.label);

        return (
          <div
            className="rank-row"
            key={row.label}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? selected : undefined}
            data-selected={selected ? '' : undefined}
            data-select-type={kind}
            style={interactive ? { cursor: 'pointer' } : undefined}
            onClick={interactive ? () => toggle(row.label) : undefined}
            onKeyDown={interactive ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row.label); }
            } : undefined}
          >
            <div className="rank-meta">
              <span className="rank-label" title={row.label}>{row.label}</span>
              <span className="rank-value">{row.value.toLocaleString()}</span>
            </div>
            <div className="rank-track">
              <div className="rank-fill" style={{ width, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
