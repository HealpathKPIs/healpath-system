'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import CompareCenter from './CompareCenter';

const MONTH_LABEL: Record<string, string> = {
  '2026-01': 'Jan 2026', '2026-02': 'Feb 2026', '2026-03': 'Mar 2026',
  '2026-04': 'Apr 2026', '2026-05': 'May 2026', '2026-06': 'Jun 2026',
};

function monthLabel(value: string) {
  if (MONTH_LABEL[value]) return MONTH_LABEL[value];
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export default function FilterBar({
  months,
  specialties,
  doctors,
  riskCarriers,
  monthsLive = false,
}: {
  months: string[];
  specialties: string[];
  doctors: string[];
  riskCarriers: string[];
  /**
   * True when `months` is the live database enumeration rather than a page's own
   * (already filtered) chart months. Only a live list is authoritative enough to
   * reset a month selection that no longer exists.
   */
  monthsLive?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { selection, setSelection } = useDashboard();
  const doctor = params.get('doctor') ?? '';
  const [compareOpen, setCompareOpen] = useState(false);

  // Selections survive an import whenever the value still exists. When an import
  // removes one (a doctor who left, a risk carrier that was renamed) the filter
  // would otherwise keep querying a value that is gone and show an empty
  // dashboard, so it falls back to "All" and the URL is rewritten to match.
  // An empty list means "could not enumerate" — never reset on that.
  useEffect(() => {
    const stale: string[] = [];
    if (monthsLive && months.length && params.get('month') && !months.includes(params.get('month')!)) stale.push('month');
    if (specialties.length && params.get('specialty') && !specialties.includes(params.get('specialty')!)) stale.push('specialty');
    if (doctors.length && params.get('doctor') && !doctors.includes(params.get('doctor')!)) stale.push('doctor');
    if (riskCarriers.length && params.get('riskCarrier') && !riskCarriers.includes(params.get('riskCarrier')!)) stale.push('riskCarrier');
    if (!stale.length) return;

    const next = new URLSearchParams(params.toString());
    for (const key of stale) next.delete(key);
    if (stale.includes('doctor') && next.get('sel') === 'doctor') {
      next.delete('sel');
      next.delete('selv');
    }
    const query = next.toString();
    // replace(), not push(): a filter value that no longer exists should not be
    // reachable with the Back button.
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [months, specialties, doctors, riskCarriers, monthsLive, params, pathname, router]);

  useEffect(() => {
    if (doctor) {
      if (selection?.type !== 'doctor' || selection.value !== doctor) {
        setSelection({ type: 'doctor', value: doctor });
      }
      return;
    }
    if (selection?.type === 'doctor') {
      setSelection(null);
    }
  }, [doctor, selection, setSelection]);

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'doctor') {
      next.delete('sel');
      next.delete('selv');
      setSelection(value ? { type: 'doctor', value } : null);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="filters" aria-label="Dashboard filters">
      <select aria-label="Month" value={params.get('month') ?? ''} onChange={(e) => set('month', e.target.value)}>
        <option value="">All months</option>
        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <select aria-label="Specialty" value={params.get('specialty') ?? ''} onChange={(e) => set('specialty', e.target.value)}>
        <option value="">All specialties</option>
        {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select aria-label="Doctor" value={doctor} onChange={(e) => set('doctor', e.target.value)}>
        <option value="">All doctors</option>
        {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select aria-label="Risk Carrier" value={params.get('riskCarrier') ?? ''} onChange={(e) => set('riskCarrier', e.target.value)}>
        <option value="">All</option>
        {riskCarriers.map((carrier) => <option key={carrier} value={carrier}>{carrier}</option>)}
      </select>
      <button
        type="button"
        aria-label="Open Compare Center"
        onClick={() => setCompareOpen(true)}
        style={{ height: 36, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, padding: '0 12px', whiteSpace: 'nowrap' }}
      >
        ⚖ Compare
      </button>
      <CompareCenter open={compareOpen} onClose={() => setCompareOpen(false)} months={months} doctors={doctors} />
    </div>
  );
}
