'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const MONTH_LABEL: Record<string, string> = {
  '2026-01': 'Jan 2026', '2026-02': 'Feb 2026', '2026-03': 'Mar 2026',
  '2026-04': 'Apr 2026', '2026-05': 'May 2026', '2026-06': 'Jun 2026',
};

export default function FilterBar({ months, specialties, doctors }: { months: string[]; specialties: string[]; doctors: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="filters" aria-label="Dashboard filters">
      <select aria-label="Month" value={params.get('month') ?? ''} onChange={(e) => set('month', e.target.value)}>
        <option value="">All months</option>
        {months.map((m) => <option key={m} value={m}>{MONTH_LABEL[m] ?? m}</option>)}
      </select>
      <select aria-label="Specialty" value={params.get('specialty') ?? ''} onChange={(e) => set('specialty', e.target.value)}>
        <option value="">All specialties</option>
        {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select aria-label="Doctor" value={params.get('doctor') ?? ''} onChange={(e) => set('doctor', e.target.value)}>
        <option value="">All doctors</option>
        {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}
