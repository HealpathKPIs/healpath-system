// Data collection for the vector Executive Report. Client-side fetches against
// the EXISTING API routes only (/api/kpis, /api/diseases, /api/drugs,
// /api/diagnostics, /api/trends, /api/specialties) — the exact same query layer
// the dashboards use, so every number in the report matches the screens.
// Reporting model: the selected (or latest) month, with deltas vs the previous
// month — the semi-monthly executive comparison.

import type { DoctorRow, Kpis, RankRow, TrendResponse } from '../types';

export interface ReportFilters {
  month: string | null;
  specialty: string | null;
  doctor: string | null;
}

export interface ExecutiveReportBundle {
  reportingMonth: string;
  reportingLabel: string;
  previousMonth: string | null;
  previousLabel: string | null;
  compareDayThrough: number | null;
  previousWindowLabel: string | null;
  filters: ReportFilters;
  kpis: { current: Kpis; previous: Kpis | null };
  diseases: { blocks: RankRow[]; descriptions: RankRow[] };
  drugs: { ac: RankRow[]; brands: RankRow[] };
  diagnostics: { labs: RankRow[]; scans: RankRow[]; avgLabs: number; avgScans: number };
  trends: TrendResponse;
  specialties: { ranking: RankRow[]; doctors: DoctorRow[] };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(ym: string | null): string {
  if (!ym) return 'All months';
  const match = ym.match(/^(\d{4})-(\d{2})/);
  if (!match) return ym;
  const index = Number(match[2]) - 1;
  return `${MONTH_NAMES[index] ?? match[2]} ${match[1]}`;
}

export function pctChange(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function query(params: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Report data request failed (${url} -> HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);

function cleanKpis(raw: Partial<Kpis> | null | undefined): Kpis {
  return {
    visits: num(raw?.visits),
    patients: num(raw?.patients),
    doctors: num(raw?.doctors),
    specialties: num(raw?.specialties),
    avgMeds: num(raw?.avgMeds),
    avgLabs: num(raw?.avgLabs),
    avgScans: num(raw?.avgScans),
  };
}

function cleanRows(rows: unknown): RankRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({ label: String((row as RankRow)?.label ?? '').trim(), value: num((row as RankRow)?.value) }))
    .filter((row) => row.label);
}

export async function collectReportData(search: string, onProgress?: (detail: string) => void): Promise<ExecutiveReportBundle> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const filters: ReportFilters = {
    month: params.get('month')?.trim() || null,
    specialty: params.get('specialty')?.trim() || null,
    doctor: params.get('doctor')?.trim() || null,
  };

  onProgress?.('Collecting data (trends)');
  const trends = await fetchJson<TrendResponse>(`/api/trends${query({ specialty: filters.specialty, doctor: filters.doctor })}`);
  const months = (trends.points ?? []).map((point) => point.month);

  // Reporting month = the selected month when it exists in the data, else the
  // latest month; previous = the month before it (null on the first month).
  const reportingMonth = filters.month && months.includes(filters.month)
    ? filters.month
    : months[months.length - 1] ?? filters.month ?? '';
  const reportingIndex = months.indexOf(reportingMonth);
  const previousMonth = reportingIndex > 0 ? months[reportingIndex - 1] : null;
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Semi-monthly rule: an incomplete current-calendar reporting month compares
  // against days 1-15 of the previous month.
  const compareDayThrough = reportingMonth === currentYm ? 15 : null;

  const scope = { specialty: filters.specialty, doctor: filters.doctor };
  onProgress?.('Collecting data (dashboards)');
  const [currentKpis, previousKpis, diseases, drugs, diagnostics, specialties] = await Promise.all([
    fetchJson<Kpis>(`/api/kpis${query({ ...scope, month: reportingMonth || null })}`),
    previousMonth
      ? fetchJson<Kpis>(`/api/kpis${query({
          ...scope,
          month: previousMonth,
          dayThrough: compareDayThrough ? String(compareDayThrough) : null,
        })}`)
      : Promise.resolve(null),
    fetchJson<{ blocks: RankRow[]; descriptions: RankRow[] }>(`/api/diseases${query({ ...scope, month: reportingMonth || null, limit: '10' })}`),
    fetchJson<{ ac: RankRow[]; brands: RankRow[] }>(`/api/drugs${query({ ...scope, month: reportingMonth || null })}`),
    fetchJson<{ labs: RankRow[]; scans: RankRow[]; avgLabs: number; avgScans: number }>(`/api/diagnostics${query({ ...scope, month: reportingMonth || null })}`),
    fetchJson<{ ranking: RankRow[]; doctors: DoctorRow[] }>(`/api/specialties${query({ month: reportingMonth || null, specialty: filters.specialty })}`),
  ]);

  return {
    reportingMonth,
    reportingLabel: monthLabel(reportingMonth || null),
    previousMonth,
    previousLabel: previousMonth ? monthLabel(previousMonth) : null,
    compareDayThrough,
    previousWindowLabel: previousMonth
      ? compareDayThrough
        ? `${monthLabel(previousMonth)} (days 1-${compareDayThrough})`
        : monthLabel(previousMonth)
      : null,
    filters,
    kpis: { current: cleanKpis(currentKpis), previous: previousKpis ? cleanKpis(previousKpis) : null },
    diseases: { blocks: cleanRows(diseases?.blocks), descriptions: cleanRows(diseases?.descriptions) },
    drugs: { ac: cleanRows(drugs?.ac), brands: cleanRows(drugs?.brands) },
    diagnostics: {
      labs: cleanRows(diagnostics?.labs),
      scans: cleanRows(diagnostics?.scans),
      avgLabs: num(diagnostics?.avgLabs),
      avgScans: num(diagnostics?.avgScans),
    },
    trends: {
      points: (trends.points ?? []).map((point) => ({
        month: point.month,
        meds: num(point.meds),
        labs: num(point.labs),
        scans: num(point.scans),
        visits: point.visits === undefined ? undefined : num(point.visits),
      })),
      delta: { meds: num(trends.delta?.meds), labs: num(trends.delta?.labs), scans: num(trends.delta?.scans) },
      arrows: trends.arrows,
    },
    specialties: {
      ranking: cleanRows(specialties?.ranking),
      doctors: Array.isArray(specialties?.doctors)
        ? specialties.doctors.map((row) => ({
            practitioner: String(row?.practitioner ?? '').trim(),
            specialty: String(row?.specialty ?? '').trim(),
            visits: num(row?.visits),
            medsPerVisit: num(row?.medsPerVisit),
            labsPerVisit: num(row?.labsPerVisit),
          })).filter((row) => row.practitioner)
        : [],
    },
  };
}
