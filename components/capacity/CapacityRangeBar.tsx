'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Date range control for the capacity pages.
 *
 * Capacity is measured over arbitrary ranges (1 Aug to 25 Oct, say), which the
 * dashboard's month-only FilterBar cannot express, so this owns `from` and `to`
 * and leaves every other search parameter untouched. The global month, specialty
 * and doctor filters still travel through unchanged.
 */

const control: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 8,
  padding: '6px 10px',
  font: 'inherit',
  fontSize: 13,
};

export interface CapacityRangeBarProps {
  from: string;
  to: string;
  /** Earliest and latest dates that actually have data. */
  min: string | null;
  max: string | null;
}

export default function CapacityRangeBar({ from, to, min, max }: CapacityRangeBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = useCallback(
    (next: { from?: string; to?: string }) => {
      const query = new URLSearchParams(params.toString());
      if (next.from) query.set('from', next.from);
      if (next.to) query.set('to', next.to);
      router.replace(`${pathname}?${query.toString()}`);
    },
    [params, pathname, router],
  );

  const lastDays = useCallback(
    (days: number) => {
      if (!max) return;
      const end = new Date(`${max}T00:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));
      const startIso = start.toISOString().slice(0, 10);
      apply({ from: min && startIso < min ? min : startIso, to: max });
    },
    [apply, max, min],
  );

  return (
    <div className="filters" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>
        From{' '}
        <input
          type="date"
          value={from}
          min={min ?? undefined}
          max={max ?? undefined}
          onChange={(event) => apply({ from: event.target.value })}
          style={control}
        />
      </label>
      <label style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>
        To{' '}
        <input
          type="date"
          value={to}
          min={min ?? undefined}
          max={max ?? undefined}
          onChange={(event) => apply({ to: event.target.value })}
          style={control}
        />
      </label>
      <button type="button" style={control} onClick={() => lastDays(7)}>
        Last 7 days
      </button>
      <button type="button" style={control} onClick={() => lastDays(30)}>
        Last 30 days
      </button>
      <button
        type="button"
        style={control}
        onClick={() => min && max && apply({ from: min, to: max })}
      >
        All data
      </button>
    </div>
  );
}
