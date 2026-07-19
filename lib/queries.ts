// The metric library. Every measure from the Power BI model, expressed as SQL
// against the healpath schema, PLUS a fallback that reads the bundled 2026
// snapshot so the dashboard runs before Supabase is wired up.
//
// DAX -> SQL mapping (confirmed against the .pbix measures):
//   Avg Meds per Visit  = DIVIDE(COUNT(Drug_Fact[brand]),  DISTINCTCOUNT(Visit[VisitID]))
//   Avg Labs per Visit  = DIVIDE(COUNT(Lab_Fact[Tests]),   DISTINCTCOUNT(Visit[VisitID]))
//   Avg Scans per Visit = DIVIDE(COUNT(Scan_Fact[Tests]),  DISTINCTCOUNT(Visit[VisitID]))
//   Visits              = DISTINCTCOUNT(Visit[VisitID])
//   Patients            = DISTINCTCOUNT(Visit[Patient Id])
// DAX COUNT on a text column ignores blanks, so the SQL counts non-blank rows.

import { dbQuery, hasDb } from './pg';
import type { Filters, Kpis, RankRow, TrendPoint, TrendResponse, TrendArrow, DoctorRow } from './types';
import snapshot from '../data/snapshot2026.json';
import {
  type ChronicCalendarEntry,
  CHRONIC_CALENDAR_SEED,
  chronicEntryForWeek,
  chronicPeriodsForWeeks,
  chronicYm,
} from './chronic-calendar';

export type PerformanceEntityKind = 'doctors' | 'specialties' | 'medications' | 'laboratories' | 'scans';
export interface PerformanceEntityMetric {
  entity: string;
  month: string;
  visits: number;
  avgMeds: number;
  avgLabs: number;
  avgScans: number;
}

// Base population for every live metric = the 2026 reporting window (this is the
// scope the Power BI model is built on; the raw table also holds 2025 rows).
// Positional binds: $1 = month, $2 = specialty, $3 = doctor (practitioner_name),
// $4 = drug (cross-filter: visits containing this active ingredient OR brand),
// $5 = disease (cross-filter: visits containing this ICD block). All nullable.
// Any per-query LIMIT therefore uses $6.
const VISIT_FILTER =
  "v.month_year like '2026-%' and ($1::text is null or v.month_year = $1) " +
  "and ($2::text is null or v.doctor_specialty = $2) " +
  "and ($3::text is null or v.practitioner_name = $3) " +
  "and ($4::text is null or v.visit_id in (select xdf.visit_id from healpath.drug_fact xdf where xdf.ac = $4 or lower(btrim(xdf.brand)) = $4)) " +
  "and ($5::text is null or v.visit_id in (select xdg.visit_id from healpath.diagnosis_fact xdg where xdg.icd_block = $5))";

function arrow(delta: number): TrendArrow {
  if (delta > 0) return '▲ Increase';
  if (delta < 0) return '▼ Decrease';
  return '▬ No Change';
}

function specialtyParam(s?: string | null): string | null {
  return s ? s.trim() : null;
}

function doctorParam(s?: string | null): string | null {
  return s ? s.trim() : null;
}
function drugParam(s?: string | null): string | null {
  return s ? s.trim() : null;
}
function diseaseParam(s?: string | null): string | null {
  return s ? s.trim() : null;
}

// Standard positional binds for VISIT_FILTER ($1..$5). Append a LIMIT as $6.
function visitParams(f: Filters): (string | null)[] {
  return [f.month ?? null, specialtyParam(f.specialty), doctorParam(f.doctor), drugParam(f.drug), diseaseParam(f.disease)];
}

// Sprint 19 search: `%term%` ILIKE pattern (min 2 chars) bound as $7 on the
// search-enabled queries; null when there is no (valid) search term.
function searchLike(f: Filters): string | null {
  const s = f.search?.trim();
  return s && s.length >= 2 ? `%${s}%` : null;
}
// Snapshot-fallback search: case-insensitive `includes` on the row label.
function applySearch<T extends RankRow>(rows: T[], f: Filters): T[] {
  const s = f.search?.trim().toLowerCase();
  if (!s || s.length < 2) return rows;
  return rows.filter((r) => r.label.toLowerCase().includes(s));
}

// Resolve the effective server-side filters from the URL search params, applying
// the Sprint 17 selection priority:  DashboardContext selection (reflected into
// ?sel/?selv)  >  URL dropdown filter  >  default (null).
// `honor` controls which cross-filter dimensions a given page responds to.
export interface SelectionParams {
  month?: string; specialty?: string; doctor?: string; sel?: string; selv?: string; q?: string;
}
export function resolveFilters(
  sp: SelectionParams,
  honor: { doctor?: boolean; drug?: boolean; disease?: boolean } = { doctor: true },
): Filters {
  const type = sp.sel;
  const value = sp.selv ?? null;
  const sel = type && value ? { type, value } : null;
  const doctorHonored = honor.doctor !== false;
  return {
    month: sp.month ?? null,
    specialty: (sel?.type === 'specialty' ? sel.value : sp.specialty) ?? null,
    doctor: doctorHonored ? ((sel?.type === 'doctor' ? sel.value : sp.doctor) ?? null) : null,
    drug: honor.drug && sel?.type === 'drug' ? sel.value : null,
    disease: honor.disease && sel?.type === 'disease' ? sel.value : null,
    search: sp.q?.trim() || null,
  };
}

// --- WHERE clause helper shared by every query -----------------------------
function whereClause(f: Filters): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.month) { clauses.push('v.month_year = :month'); params.month = f.month; }
  if (f.specialty) { clauses.push('v.doctor_specialty = :specialty'); params.specialty = f.specialty; }
  return { sql: clauses.length ? 'where ' + clauses.join(' and ') : '', params };
}

// ---------------------------------------------------------------------------
// SQL text for each measure. These run through supabase.rpc('exec_sql', ...)
// or a Postgres view in production. Kept as exported strings so they're
// documented, testable, and match the API routes 1:1.
// ---------------------------------------------------------------------------

export const SQL = {
  kpis: (f: Filters) => {
    const { sql } = whereClause(f);
    return `
      with base as (select v.visit_id, v.patient_id from healpath.visits v ${sql})
      select
        (select count(distinct visit_id) from base)                                        as visits,
        (select count(distinct patient_id) from base)                                      as patients,
        (select count(distinct v.practitioner_name) from healpath.visits v ${sql})         as doctors,
        (select count(distinct v.doctor_specialty) from healpath.visits v ${sql})          as specialties,
        (select count(d.brand)::numeric from healpath.drug_fact d
           join healpath.visits v on v.visit_id = d.visit_id ${sql})
          / nullif((select count(distinct visit_id) from base),0)                          as avg_meds,
        (select count(l.tests)::numeric from healpath.lab_fact l
           join healpath.visits v on v.visit_id = l.visit_id ${sql})
          / nullif((select count(distinct visit_id) from base),0)                          as avg_labs,
        (select count(s.tests)::numeric from healpath.scan_fact s
           join healpath.visits v on v.visit_id = s.visit_id ${sql})
          / nullif((select count(distinct visit_id) from base),0)                          as avg_scans;`;
  },

  topIcdBlock: (f: Filters, limit = 10) => {
    const { sql } = whereClause(f);
    return `select dg.icd_block as label, count(*) as value
            from healpath.diagnosis_fact dg
            join healpath.visits v on v.visit_id = dg.visit_id ${sql}
            where dg.icd_block is not null and btrim(dg.icd_block) <> ''
            group by dg.icd_block order by value desc limit ${limit};`;
  },

  topActiveIngredient: (f: Filters, limit = 15) => {
    const { sql } = whereClause(f);
    return `select d.ac as label, count(*) as value
            from healpath.drug_fact d
            join healpath.visits v on v.visit_id = d.visit_id ${sql}
            where d.ac is not null and btrim(d.ac) not in ('','0')
            group by d.ac order by value desc limit ${limit};`;
  },

  topBrand: (f: Filters, limit = 10) => {
    const { sql } = whereClause(f);
    return `select lower(btrim(d.brand)) as label, count(*) as value
            from healpath.drug_fact d
            join healpath.visits v on v.visit_id = d.visit_id ${sql}
            where d.brand is not null and btrim(d.brand) <> ''
            group by lower(btrim(d.brand)) order by value desc limit ${limit};`;
  },

  topTests: (table: 'lab_fact' | 'scan_fact', f: Filters, limit = 10) => {
    const { sql } = whereClause(f);
    return `select t.tests as label, count(*) as value
            from healpath.${table} t
            join healpath.visits v on v.visit_id = t.visit_id ${sql}
            where t.tests is not null and btrim(t.tests) <> ''
            group by t.tests order by value desc limit ${limit};`;
  },

  visitsBySpecialty: (f: Filters) => {
    const { sql } = whereClause(f);
    return `select v.doctor_specialty as label, count(distinct v.visit_id) as value
            from healpath.visits v ${sql}
            group by v.doctor_specialty order by value desc;`;
  },

  doctorMatrix: (f: Filters, limit = 20) => {
    const { sql } = whereClause(f);
    return `
      with dv as (select v.visit_id, v.practitioner_name, v.doctor_specialty from healpath.visits v ${sql})
      select dv.practitioner_name as practitioner,
             max(dv.doctor_specialty) as specialty,
             count(distinct dv.visit_id) as visits,
             count(d.brand)::numeric / nullif(count(distinct dv.visit_id),0) as meds_per_visit,
             count(l.tests)::numeric / nullif(count(distinct dv.visit_id),0) as labs_per_visit
      from dv
      left join healpath.drug_fact d on d.visit_id = dv.visit_id
      left join healpath.lab_fact  l on l.visit_id = dv.visit_id
      group by dv.practitioner_name order by visits desc limit ${limit};`;
  },

  // Trend is always the full window on the month axis; specialty may filter it.
  trend: (specialty?: string | null) => `
    with months as (
      select v.month_year,
             count(distinct v.visit_id) as visits
      from healpath.visits v
      ${specialty ? 'where v.doctor_specialty = :specialty' : ''}
      group by v.month_year
    )
    select m.month_year as month,
           (select count(d.brand)::numeric from healpath.drug_fact d
              join healpath.visits v on v.visit_id = d.visit_id
              where v.month_year = m.month_year ${specialty ? 'and v.doctor_specialty = :specialty' : ''})
             / nullif(m.visits,0) as meds,
           (select count(l.tests)::numeric from healpath.lab_fact l
              join healpath.visits v on v.visit_id = l.visit_id
              where v.month_year = m.month_year ${specialty ? 'and v.doctor_specialty = :specialty' : ''})
             / nullif(m.visits,0) as labs,
           (select count(s.tests)::numeric from healpath.scan_fact s
              join healpath.visits v on v.visit_id = s.visit_id
              where v.month_year = m.month_year ${specialty ? 'and v.doctor_specialty = :specialty' : ''})
             / nullif(m.visits,0) as scans
    from months m order by m.month_year;`,
};

// ---------------------------------------------------------------------------
// Data access. When Supabase is configured we run the SQL above via an RPC;
// otherwise we serve the bundled snapshot so the UI is fully functional in dev
// and in the deployed preview before the monthly import has run.
// ---------------------------------------------------------------------------

type Snap = typeof snapshot;
function snapFor(f: Filters): Snap['all'] {
  if (f.month && (snapshot.byMonth as Record<string, Snap['all']>)[f.month]) {
    return (snapshot.byMonth as Record<string, Snap['all']>)[f.month];
  }
  return snapshot.all;
}

function snapshotRankValue(rows: unknown, entity: string): number {
  return ((rows ?? []) as [string, number][])
    .find(([label]) => label === entity)?.[1] ?? 0;
}

function snapshotPerformanceMetrics(
  kind: PerformanceEntityKind,
  entities: string[],
  months: string[],
): PerformanceEntityMetric[] {
  return entities.flatMap((entity) => months.map((month) => {
    const s = (snapshot.byMonth as Record<string, Snap['all']>)[month] ?? snapshot.all;
    const doctor = kind === 'doctors'
      ? (s.doctors as DoctorRow[]).find((row) => row.practitioner === entity)
      : null;
    const visits = kind === 'doctors'
      ? doctor?.visits ?? 0
      : kind === 'specialties'
        ? snapshotRankValue(s.specialty, entity)
        : kind === 'medications'
          ? snapshotRankValue(s.topAc, entity) || snapshotRankValue(s.topBrand, entity)
          : kind === 'laboratories'
            ? snapshotRankValue(s.topLab, entity)
            : snapshotRankValue(s.topScan, entity);
    return {
      entity,
      month,
      visits,
      avgMeds: doctor?.medsPerVisit ?? s.kpi.avgMeds,
      avgLabs: doctor?.labsPerVisit ?? s.kpi.avgLabs,
      avgScans: s.kpi.avgScans,
    };
  }));
}

// --- live enumeration cache --------------------------------------------------
// listMonths/listSpecialties must stay SYNCHRONOUS (they are called synchronously
// in server components — the (): string[] contract cannot change). We therefore
// warm a module-level cache from Postgres asynchronously (fire-and-forget,
// memoised) and the sync accessors return the live cached values once available,
// falling back to the bundled snapshot until then or if the DB is unreachable.
let monthsCache: string[] | null = null;
let specialtiesCache: string[] | null = null;
let doctorsCache: string[] | null = null;
let enumWarming: Promise<void> | null = null;

async function refreshEnumerations(): Promise<void> {
  if (!hasDb) return;
  try {
    const [months, specialties, doctors] = await Promise.all([
      dbQuery<{ month_year: string }>(
        "select distinct month_year from healpath.visits where month_year like '2026-%' order by month_year",
      ),
      dbQuery<{ s: string }>(
        "select distinct btrim(doctor_specialty) as s from healpath.visits " +
          "where month_year like '2026-%' and doctor_specialty is not null and btrim(doctor_specialty) <> '' order by 1",
      ),
      dbQuery<{ d: string }>(
        "select distinct btrim(practitioner_name) as d from healpath.visits " +
          "where month_year like '2026-%' and practitioner_name is not null and btrim(practitioner_name) <> '' order by 1",
      ),
    ]);
    if (months.length) monthsCache = months.map((r) => r.month_year);
    if (specialties.length) specialtiesCache = specialties.map((r) => r.s);
    if (doctors.length) doctorsCache = doctors.map((r) => r.d);
  } catch (e) {
    console.warn('listMonths/listSpecialties/listDoctors live refresh failed, snapshot retained:', (e as Error).message);
  }
}

// Snapshot fallback for the doctor list (the bundled snapshot only carries the
// top-20 doctor matrix, which is enough until the live cache warms / if DB down).
function snapshotDoctors(): string[] {
  return [...new Set((snapshot.all.doctors as DoctorRow[]).map((d) => d.practitioner))].sort();
}

// Warm once; safe to call from the sync accessors (non-blocking) or to await in tests.
export function warmEnumerations(): Promise<void> {
  if (!enumWarming) enumWarming = refreshEnumerations();
  return enumWarming;
}

export function listMonths(): string[] {
  if (hasDb) void warmEnumerations();
  return monthsCache ?? (snapshot.months as string[]);
}
export function listSpecialties(): string[] {
  if (hasDb) void warmEnumerations();
  return specialtiesCache ?? (snapshot.specialties as string[]);
}
export function listDoctors(): string[] {
  if (hasDb) void warmEnumerations();
  return doctorsCache ?? snapshotDoctors();
}

export async function getKpis(f: Filters): Promise<Kpis> {
  if (hasDb) {
    try {
      const params: unknown[] = visitParams(f);
      let dayClause = '';
      if (f.dayThrough) {
        params.push(f.dayThrough);
        // Rows with a nulled prescription_date (the folded-1970 rows) are kept
        // in both windows so the two sides stay comparable.
        dayClause = ` and (v.prescription_date is null or extract(day from v.prescription_date) <= $${params.length})`;
      }
      const kpiVisitFilter = `${VISIT_FILTER}${dayClause}`;
      const rows = await dbQuery<Record<string, unknown>>(`
        with base as (
          select v.visit_id, v.patient_id from healpath.visits v where ${kpiVisitFilter}
        )
        select
          (select count(distinct visit_id) from base) as visits,
          (select count(distinct patient_id) from base) as patients,
          (select count(distinct v.practitioner_name) from healpath.visits v where ${kpiVisitFilter}) as doctors,
          (select count(distinct v.doctor_specialty) from healpath.visits v where ${kpiVisitFilter}) as specialties,
          (select count(d.brand)::numeric from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id where ${kpiVisitFilter})
            / nullif((select count(distinct visit_id) from base), 0) as avg_meds,
          (select count(l.tests)::numeric from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id where ${kpiVisitFilter})
            / nullif((select count(distinct visit_id) from base), 0) as avg_labs,
          (select count(s.tests)::numeric from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id where ${kpiVisitFilter})
            / nullif((select count(distinct visit_id) from base), 0) as avg_scans
      `, params);
      const r = rows[0];
      if (r) {
        return {
          visits: Number(r.visits), patients: Number(r.patients),
          doctors: Number(r.doctors), specialties: Number(r.specialties),
          avgMeds: Number(Number(r.avg_meds).toFixed(2)),
          avgLabs: Number(Number(r.avg_labs).toFixed(2)),
          avgScans: Number(Number(r.avg_scans).toFixed(2)),
        };
      }
    } catch (e) {
      console.warn('getKpis live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return snapFor(f).kpi;
}

function toRank(rows: [string, number][]): RankRow[] {
  return rows.map(([label, value]) => ({ label, value }));
}

function roundRatio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  const scaled = numerator * 100;
  const whole = Math.floor(scaled / denominator);
  const remainder = scaled % denominator;
  const doubled = remainder * 2;
  const rounded = doubled > denominator || (doubled === denominator && whole % 2 === 1) ? whole + 1 : whole;
  return rounded / 100;
}

export async function getDiseases(f: Filters, limit = 10): Promise<RankRow[]> {
  if (hasDb) {
    try {
      const rows = await dbQuery<{ label: string; value: number }>(`
        select dg.icd_block as label, count(*)::int as value
        from healpath.diagnosis_fact dg join healpath.visits v on v.visit_id = dg.visit_id
        where ${VISIT_FILTER} and dg.icd_block is not null and btrim(dg.icd_block) <> ''
        group by dg.icd_block order by value desc limit $6
      `, [...visitParams(f), limit]);
      return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
    } catch (e) {
      console.warn('getDiseases live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return toRank(snapFor(f).topIcd.slice(0, limit) as [string, number][]);
}
export async function getDiseaseDescriptions(f: Filters): Promise<RankRow[]> {
  if (hasDb) {
    try {
      const rows = await dbQuery<{ label: string; value: number }>(`
        select dg.icd_desc as label, count(*)::int as value
        from healpath.diagnosis_fact dg join healpath.visits v on v.visit_id = dg.visit_id
        where ${VISIT_FILTER} and dg.icd_desc is not null and btrim(dg.icd_desc) <> ''
          and ($7::text is null or dg.icd_desc ilike $7 or dg.diseases ilike $7)
        group by dg.icd_desc order by value desc limit $6
      `, [...visitParams(f), 15, searchLike(f)]);
      return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
    } catch (e) {
      console.warn('getDiseaseDescriptions live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return applySearch(toRank(snapFor(f).topIcdDesc as [string, number][]), f);
}
export async function getDrugs(f: Filters): Promise<{ ac: RankRow[]; brands: RankRow[] }> {
  if (hasDb) {
    try {
      const [ac, brands] = await Promise.all([
        dbQuery<{ label: string; value: number }>(`
          select d.ac as label, count(*)::int as value
          from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id
          where ${VISIT_FILTER} and d.ac is not null and btrim(d.ac) not in ('', '0')
            and ($7::text is null or d.ac ilike $7 or d.brand ilike $7 or d.medications ilike $7)
          group by d.ac order by value desc limit $6
        `, [...visitParams(f), 15, searchLike(f)]),
        dbQuery<{ label: string; value: number }>(`
          select lower(btrim(d.brand)) as label, count(*)::int as value
          from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id
          where ${VISIT_FILTER} and d.brand is not null and btrim(d.brand) <> ''
            and ($7::text is null or d.brand ilike $7 or d.ac ilike $7 or d.medications ilike $7)
          group by lower(btrim(d.brand)) order by value desc limit $6
        `, [...visitParams(f), 10, searchLike(f)]),
      ]);
      return {
        ac: ac.map((r) => ({ label: r.label, value: Number(r.value) })),
        brands: brands.map((r) => ({ label: r.label, value: Number(r.value) })),
      };
    } catch (e) {
      console.warn('getDrugs live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  const s = snapFor(f);
  return { ac: applySearch(toRank(s.topAc as [string, number][]), f), brands: applySearch(toRank(s.topBrand as [string, number][]), f) };
}
export async function getDiagnostics(f: Filters): Promise<{ labs: RankRow[]; scans: RankRow[] }> {
  if (hasDb) {
    try {
      const [labs, scans] = await Promise.all([
        dbQuery<{ label: string; value: number }>(`
          select l.tests as label, count(*)::int as value
          from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id
          where ${VISIT_FILTER} and l.tests is not null and btrim(l.tests) <> ''
            and ($7::text is null or l.tests ilike $7)
          group by l.tests order by value desc limit $6
        `, [...visitParams(f), 10, searchLike(f)]),
        dbQuery<{ label: string; value: number }>(`
          select s.tests as label, count(*)::int as value
          from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id
          where ${VISIT_FILTER} and s.tests is not null and btrim(s.tests) <> ''
            and ($7::text is null or s.tests ilike $7)
          group by s.tests order by value desc limit $6
        `, [...visitParams(f), 10, searchLike(f)]),
      ]);
      return {
        labs: labs.map((r) => ({ label: r.label, value: Number(r.value) })),
        scans: scans.map((r) => ({ label: r.label, value: Number(r.value) })),
      };
    } catch (e) {
      console.warn('getDiagnostics live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  const s = snapFor(f);
  return { labs: applySearch(toRank(s.topLab as [string, number][]), f), scans: applySearch(toRank(s.topScan as [string, number][]), f) };
}

export async function getDiagnosticEntityKpis(kind: 'lab' | 'scan', entity: string, f: Filters): Promise<Kpis> {
  const table = kind === 'lab' ? 'lab_fact' : 'scan_fact';
  if (hasDb) {
    try {
      const rows = await dbQuery<Record<string, unknown>>(`
        with base as (
          select v.visit_id, v.patient_id
          from healpath.visits v
          where ${VISIT_FILTER}
            and v.visit_id in (
              select x.visit_id
              from healpath.${table} x
              where x.tests = $6
            )
        )
        select
          (select count(distinct visit_id) from base) as visits,
          (select count(distinct patient_id) from base) as patients,
          (select count(distinct v.practitioner_name) from healpath.visits v where ${VISIT_FILTER} and v.visit_id in (select visit_id from base)) as doctors,
          (select count(distinct v.doctor_specialty) from healpath.visits v where ${VISIT_FILTER} and v.visit_id in (select visit_id from base)) as specialties,
          (select count(d.brand)::numeric from healpath.drug_fact d join base b on b.visit_id = d.visit_id)
            / nullif((select count(distinct visit_id) from base), 0) as avg_meds,
          (select count(l.tests)::numeric from healpath.lab_fact l join base b on b.visit_id = l.visit_id)
            / nullif((select count(distinct visit_id) from base), 0) as avg_labs,
          (select count(s.tests)::numeric from healpath.scan_fact s join base b on b.visit_id = s.visit_id)
            / nullif((select count(distinct visit_id) from base), 0) as avg_scans
      `, [...visitParams(f), entity]);
      const r = rows[0];
      if (r) {
        return {
          visits: Number(r.visits), patients: Number(r.patients),
          doctors: Number(r.doctors), specialties: Number(r.specialties),
          avgMeds: Number(Number(r.avg_meds).toFixed(2)),
          avgLabs: Number(Number(r.avg_labs).toFixed(2)),
          avgScans: Number(Number(r.avg_scans).toFixed(2)),
        };
      }
    } catch (e) {
      console.warn('getDiagnosticEntityKpis live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return snapFor(f).kpi;
}

export async function getPerformanceEntityMetrics(
  kind: PerformanceEntityKind,
  entities: string[],
  months: string[],
  f: Filters,
): Promise<PerformanceEntityMetric[]> {
  if (!entities.length || !months.length) return [];
  if (hasDb) {
    const params = [...visitParams(f), entities, months];
    const entitySource = (() => {
      if (kind === 'doctors') {
        return `
          select v.practitioner_name as entity, v.visit_id, v.patient_id, v.month_year
          from healpath.visits v
          where ${VISIT_FILTER}
            and v.month_year = any($7::text[])
            and v.practitioner_name = any($6::text[])
        `;
      }
      if (kind === 'specialties') {
        return `
          select v.doctor_specialty as entity, v.visit_id, v.patient_id, v.month_year
          from healpath.visits v
          where ${VISIT_FILTER}
            and v.month_year = any($7::text[])
            and v.doctor_specialty = any($6::text[])
        `;
      }
      if (kind === 'medications') {
        return `
          select target.entity, v.visit_id, v.patient_id, v.month_year
          from healpath.visits v
          join healpath.drug_fact d on d.visit_id = v.visit_id
          join unnest($6::text[]) target(entity)
            on d.ac = target.entity or lower(btrim(d.brand)) = target.entity
          where ${VISIT_FILTER}
            and v.month_year = any($7::text[])
        `;
      }
      const table = kind === 'laboratories' ? 'lab_fact' : 'scan_fact';
      return `
        select target.entity, v.visit_id, v.patient_id, v.month_year
        from healpath.visits v
        join healpath.${table} x on x.visit_id = v.visit_id
        join unnest($6::text[]) target(entity) on x.tests = target.entity
        where ${VISIT_FILTER}
          and v.month_year = any($7::text[])
      `;
    })();
    try {
      const rows = await dbQuery<{
        entity: string;
        month: string;
        visits: number;
        avg_meds: number;
        avg_labs: number;
        avg_scans: number;
      }>(`
        with base as (
          select distinct entity, visit_id, patient_id, month_year
          from (${entitySource}) entity_visits
        ),
        visit_counts as (
          select entity, month_year, count(distinct visit_id)::int as visits
          from base
          group by entity, month_year
        ),
        drug_counts as (
          select b.entity, b.month_year, count(d.brand)::int as meds
          from base b
          join healpath.drug_fact d on d.visit_id = b.visit_id
          group by b.entity, b.month_year
        ),
        lab_counts as (
          select b.entity, b.month_year, count(l.tests)::int as labs
          from base b
          join healpath.lab_fact l on l.visit_id = b.visit_id
          group by b.entity, b.month_year
        ),
        scan_counts as (
          select b.entity, b.month_year, count(s.tests)::int as scans
          from base b
          join healpath.scan_fact s on s.visit_id = b.visit_id
          group by b.entity, b.month_year
        )
        select vc.entity,
          vc.month_year as month,
          vc.visits,
          round(coalesce(dc.meds, 0)::numeric / nullif(vc.visits, 0), 2) as avg_meds,
          round(coalesce(lc.labs, 0)::numeric / nullif(vc.visits, 0), 2) as avg_labs,
          round(coalesce(sc.scans, 0)::numeric / nullif(vc.visits, 0), 2) as avg_scans
        from visit_counts vc
        left join drug_counts dc on dc.entity = vc.entity and dc.month_year = vc.month_year
        left join lab_counts lc on lc.entity = vc.entity and lc.month_year = vc.month_year
        left join scan_counts sc on sc.entity = vc.entity and sc.month_year = vc.month_year
        order by vc.entity, vc.month_year
      `, params);
      return rows.map((row) => ({
        entity: row.entity,
        month: row.month,
        visits: Number(row.visits),
        avgMeds: Number(row.avg_meds),
        avgLabs: Number(row.avg_labs),
        avgScans: Number(row.avg_scans),
      }));
    } catch (e) {
      console.warn('getPerformanceEntityMetrics live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return snapshotPerformanceMetrics(kind, entities, months);
}
export async function getSpecialties(f: Filters): Promise<{ ranking: RankRow[]; doctors: DoctorRow[] }> {
  if (hasDb) {
    try {
      const [ranking, doctors] = await Promise.all([
        dbQuery<{ label: string; value: number }>(`
          select
            case when v.doctor_specialty = 'Chest and Respiratory' then E'Chest and Respiratory\n' else v.doctor_specialty end as label,
            count(distinct v.visit_id)::int as value
          from healpath.visits v
          where ${VISIT_FILTER} and v.doctor_specialty is not null and btrim(v.doctor_specialty) <> ''
          group by label order by value desc
        `, visitParams(f)),
        dbQuery<{ practitioner: string; specialty: string; visits: number; meds_count: number; labs_count: number }>(`
          with dv as (
            select v.visit_id, v.practitioner_name, v.doctor_specialty
            from healpath.visits v
            where ${VISIT_FILTER} and v.practitioner_name is not null and btrim(v.practitioner_name) <> ''
              and ($7::text is null or v.practitioner_name ilike $7 or v.doctor_specialty ilike $7)
          ),
          doctor_visits as (
            select dv.practitioner_name, count(distinct dv.visit_id)::int as visits
            from dv
            group by dv.practitioner_name
          ),
          doctor_specialties as (
            select practitioner_name, doctor_specialty
            from (
              select dv.practitioner_name, dv.doctor_specialty,
                row_number() over (
                  partition by dv.practitioner_name
                  order by count(distinct dv.visit_id) desc, dv.doctor_specialty asc
                ) as rn
              from dv
              group by dv.practitioner_name, dv.doctor_specialty
            ) ranked
            where rn = 1
          ),
          drug_counts as (
            select dv.practitioner_name, count(d.brand)::int as meds
            from dv join healpath.drug_fact d on d.visit_id = dv.visit_id
            group by dv.practitioner_name
          ),
          lab_counts as (
            select dv.practitioner_name, count(l.tests)::int as labs
            from dv join healpath.lab_fact l on l.visit_id = dv.visit_id
            group by dv.practitioner_name
          )
          select doctor_visits.practitioner_name as practitioner,
            doctor_specialties.doctor_specialty as specialty,
            doctor_visits.visits,
            coalesce(drug_counts.meds, 0) as meds_count,
            coalesce(lab_counts.labs, 0) as labs_count
          from doctor_visits
          join doctor_specialties on doctor_specialties.practitioner_name = doctor_visits.practitioner_name
          left join drug_counts on drug_counts.practitioner_name = doctor_visits.practitioner_name
          left join lab_counts on lab_counts.practitioner_name = doctor_visits.practitioner_name
          order by doctor_visits.visits desc, doctor_visits.practitioner_name asc
          limit $6
        `, [...visitParams(f), 20, searchLike(f)]),
      ]);
      return {
        ranking: ranking.map((r) => ({ label: r.label, value: Number(r.value) })),
        doctors: doctors.map((r) => ({
          practitioner: r.practitioner,
          specialty: r.specialty,
          visits: Number(r.visits),
          medsPerVisit: roundRatio(Number(r.meds_count), Number(r.visits)),
          labsPerVisit: roundRatio(Number(r.labs_count), Number(r.visits)),
        })),
      };
    } catch (e) {
      console.warn('getSpecialties live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  const s = snapFor(f);
  const term = f.search?.trim().toLowerCase();
  const doctors = (s.doctors as DoctorRow[]).filter((d) =>
    !term || term.length < 2 ||
    d.practitioner.toLowerCase().includes(term) || d.specialty.toLowerCase().includes(term));
  return { ranking: toRank(s.specialty as [string, number][]), doctors };
}

// --- Universal search (Sprint 19) --------------------------------------------
// Autocomplete suggestions per page scope. Live path uses SQL ILIKE (partial,
// case-insensitive); snapshot fallback uses includes(). Returns up to 8 hits.
export type SearchScope = 'diseases' | 'pharmacy' | 'diagnostics' | 'doctors';
export interface SearchHit { label: string; hint: string }

const SEARCH_SQL: Record<SearchScope, string> = {
  diseases: `
    select label, hint from (
      select dg.icd_desc as label, min(dg.diseases) as hint, count(*) as n
      from healpath.diagnosis_fact dg
      where dg.icd_desc is not null and btrim(dg.icd_desc) <> '' and (dg.icd_desc ilike $1 or dg.diseases ilike $1)
      group by dg.icd_desc order by n desc limit 8
    ) t`,
  pharmacy: `
    select label, hint from (
      (select d.ac as label, 'Ingredient' as hint, count(*) n from healpath.drug_fact d
        where d.ac is not null and btrim(d.ac) not in ('','0') and d.ac ilike $1 group by d.ac order by n desc limit 4)
      union all
      (select lower(btrim(d.brand)) as label, 'Brand' as hint, count(*) n from healpath.drug_fact d
        where d.brand is not null and btrim(d.brand) <> '' and d.brand ilike $1 group by lower(btrim(d.brand)) order by n desc limit 4)
      union all
      (select d.medications as label, 'Generic' as hint, count(*) n from healpath.drug_fact d
        where d.medications is not null and btrim(d.medications) <> '' and d.medications ilike $1 group by d.medications order by n desc limit 4)
    ) u order by n desc limit 8`,
  diagnostics: `
    select label, hint from (
      (select l.tests as label, 'Lab' as hint, count(*) n from healpath.lab_fact l
        where l.tests is not null and btrim(l.tests) <> '' and l.tests ilike $1 group by l.tests order by n desc limit 5)
      union all
      (select s.tests as label, 'Scan' as hint, count(*) n from healpath.scan_fact s
        where s.tests is not null and btrim(s.tests) <> '' and s.tests ilike $1 group by s.tests order by n desc limit 5)
    ) u order by n desc limit 8`,
  doctors: `
    select label, hint from (
      (select v.practitioner_name as label, 'Doctor' as hint, count(*) n from healpath.visits v
        where v.practitioner_name is not null and btrim(v.practitioner_name) <> '' and v.practitioner_name ilike $1 group by v.practitioner_name order by n desc limit 5)
      union all
      (select btrim(v.doctor_specialty) as label, 'Specialty' as hint, count(*) n from healpath.visits v
        where v.doctor_specialty is not null and btrim(v.doctor_specialty) <> '' and v.doctor_specialty ilike $1 group by btrim(v.doctor_specialty) order by n desc limit 4)
    ) u order by n desc limit 8`,
};

function snapshotSearch(scope: SearchScope, term: string): SearchHit[] {
  const t = term.toLowerCase();
  const inc = (label: string) => label.toLowerCase().includes(t);
  const a = snapshot.all;
  const rows: SearchHit[] = [];
  const push = (arr: [string, number][], hint: string) => {
    for (const [label] of arr) if (label && inc(label)) rows.push({ label, hint });
  };
  if (scope === 'diseases') push(a.topIcdDesc as [string, number][], 'Diagnosis');
  else if (scope === 'pharmacy') { push(a.topAc as [string, number][], 'Ingredient'); push(a.topBrand as [string, number][], 'Brand'); }
  else if (scope === 'diagnostics') { push(a.topLab as [string, number][], 'Lab'); push(a.topScan as [string, number][], 'Scan'); }
  else {
    for (const d of a.doctors as DoctorRow[]) {
      if (inc(d.practitioner)) rows.push({ label: d.practitioner, hint: 'Doctor' });
      else if (inc(d.specialty)) rows.push({ label: d.specialty, hint: 'Specialty' });
    }
  }
  return rows.slice(0, 8);
}

export async function searchOptions(scope: SearchScope, query: string): Promise<SearchHit[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  if (hasDb && SEARCH_SQL[scope]) {
    try {
      const rows = await dbQuery<SearchHit>(SEARCH_SQL[scope], [`%${term}%`]);
      return rows.map((r) => ({ label: r.label, hint: r.hint }));
    } catch (e) {
      console.warn('searchOptions live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return snapshotSearch(scope, term);
}

export async function getTrends(
  specialty?: string | null,
  doctor?: string | null,
  drug?: string | null,
  disease?: string | null,
): Promise<TrendResponse> {
  let points: TrendPoint[] | null = null;
  // Shared filter for the trend: specialty $1, doctor $2, drug $3, disease $4.
  const cond =
    "($1::text is null or v.doctor_specialty = $1) and ($2::text is null or v.practitioner_name = $2) " +
    "and ($3::text is null or v.visit_id in (select xdf.visit_id from healpath.drug_fact xdf where xdf.ac = $3 or lower(btrim(xdf.brand)) = $3)) " +
    "and ($4::text is null or v.visit_id in (select xdg.visit_id from healpath.diagnosis_fact xdg where xdg.icd_block = $4))";
  if (hasDb) {
    try {
      const rows = await dbQuery<{ month: string; visits: number; meds: number; labs: number; scans: number }>(`
        with mo as (
          select v.month_year as my, count(distinct v.visit_id) as visits
          from healpath.visits v
          where v.month_year like '2026-%' and ${cond}
          group by v.month_year
        )
        select mo.my as month,
          mo.visits::int as visits,
          round((select count(d.brand)::numeric from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id where v.month_year = mo.my and ${cond}) / nullif(mo.visits, 0), 2) as meds,
          round((select count(l.tests)::numeric from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id where v.month_year = mo.my and ${cond}) / nullif(mo.visits, 0), 2) as labs,
          round((select count(s.tests)::numeric from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id where v.month_year = mo.my and ${cond}) / nullif(mo.visits, 0), 2) as scans
        from mo order by mo.my
      `, [specialtyParam(specialty), doctorParam(doctor), drugParam(drug), diseaseParam(disease)]);
      if (rows.length) points = rows.map((r) => ({
        month: r.month,
        visits: Number(r.visits),
        meds: Number(r.meds),
        labs: Number(r.labs),
        scans: Number(r.scans),
      }));
    } catch (e) {
      console.warn('getTrends live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  if (!points) points = snapshot.trend as TrendPoint[];
  const n = points.length;
  const cur = points[n - 1], prev = points[n - 2] ?? cur;
  const d = {
    meds: Number((cur.meds - prev.meds).toFixed(2)),
    labs: Number((cur.labs - prev.labs).toFixed(2)),
    scans: Number((cur.scans - prev.scans).toFixed(2)),
  };
  return {
    points,
    delta: d,
    arrows: { meds: arrow(d.meds), labs: arrow(d.labs), scans: arrow(d.scans) },
  };
}

export interface ChronicOverviewFilters {
  period?: string | null;
  consultant?: string | null;
  recommendation?: string | null;
  issue?: string | null;
  medication?: string | null;
  patient?: string | null;
}

export interface ChronicKpiMetric {
  label: string;
  value: number;
  deltaPct: number;
  decimals?: number;
  trend: number[];
}

/** One point per business-calendar period (the primary timeline). */
export interface ChronicTrendPoint {
  /** Period label, e.g. "Jun 2026" (kept in `week` too for stable keys). */
  week: string;
  month: string;
  period: string;
  patients: number;
  prePatients: number;
  postPatients: number;
  medications: number;
  issues: number;
  recommendations: number;
  avgMedications: number;
  avgRecommendations: number;
  avgIssues: number;
}

/** Current-period vs previous-period movement for one issue/recommendation. */
export interface ChronicMover {
  label: string;
  type: 'Issue' | 'Recommendation';
  previous: number;
  current: number;
  delta: number;
  pct: number;
}

export interface ChronicAlert {
  title: string;
  label: string;
  detail: string;
  tone: 'good' | 'bad' | 'neutral';
}

/** Ranked issue/recommendation with share and period-over-period direction. */
export interface ChronicRankedItem {
  label: string;
  value: number;
  pct: number;
  trend: 'up' | 'down' | 'flat';
}

export interface ChronicParetoItem {
  label: string;
  value: number;
  pct: number;
  cumulativePct: number;
  inPareto: boolean;
}

export interface ChronicRecommendationAcceptance {
  label: string;
  pre: number;
  post: number;
  acceptancePct: number;
}

export interface ChronicConsultantAnalytics {
  label: string;
  patients: number;
  recommendations: number;
  issues: number;
  recommendationPct: number;
  issuePct: number;
  avgMedications: number;
  improvementPct: number;
}

export interface ChronicMedicationAnalytics {
  label: string;
  medications: number;
  recommendations: number;
  issues: number;
  issueRate: number;
  recommendationRate: number;
  topIssues: string[];
  topRecommendations: string[];
}

export interface ChronicAnalyticsKpi {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
}

export interface ChronicComparisonMetric {
  label: string;
  pre: number;
  post: number;
  difference: number;
  improvementPct: number;
  decimals?: number;
}

export interface ChronicOutcomeTrendPoint {
  period: string;
  preIssuesPerPatient: number;
  postIssuesPerPatient: number;
  issueImprovementPct: number;
  preRecommendationsPerPatient: number;
  postRecommendationsPerPatient: number;
  recommendationImprovementPct: number;
}

export interface ChronicCatalogComparison {
  label: string;
  pre: number;
  post: number;
  difference: number;
  improvementPct: number;
}

export interface ChronicOperationalKpis {
  waitingLab: number;
  noNeedForChronic: number;
  noNeedPct: number;
}

export interface ChronicBreakdownItem {
  label: string;
  value: number;
  pct: number;
}

export interface ChronicCorrelationPair {
  issue: string;
  recommendation: string;
  value: number;
  pct: number;
}

export interface ChronicOverviewData {
  filters: Required<ChronicOverviewFilters>;
  options: {
    periods: string[];
    weeks: string[];
    consultants: string[];
    recommendations: string[];
    issues: string[];
    medications: string[];
  };
  currentPeriod: string | null;
  previousPeriod: string | null;
  kpis: ChronicKpiMetric[];
  summary: string[];
  alerts: ChronicAlert[];
  trends: ChronicTrendPoint[];
  topIssues: ChronicRankedItem[];
  topRecommendations: ChronicRankedItem[];
  movers: { improvement: ChronicMover | null; regression: ChronicMover | null };
  prePost: {
    metrics: ChronicComparisonMetric[];
    outcomeTrends: ChronicOutcomeTrendPoint[];
    issueCatalog: ChronicCatalogComparison[];
    recommendationCatalog: ChronicCatalogComparison[];
    operational: ChronicOperationalKpis;
  };
  analytics: {
    kpis: ChronicAnalyticsKpi[];
    issuePareto: ChronicParetoItem[];
    issueSeverity: ChronicBreakdownItem[];
    issueByConsultant: ChronicBreakdownItem[];
    issueByMedication: ChronicBreakdownItem[];
    issueByPeriod: ChronicBreakdownItem[];
    recommendationAcceptance: ChronicRecommendationAcceptance[];
    recommendationByConsultant: ChronicBreakdownItem[];
    recommendationByMedication: ChronicBreakdownItem[];
    recommendationByPeriod: ChronicBreakdownItem[];
    correlations: ChronicCorrelationPair[];
    consultants: ChronicConsultantAnalytics[];
    medications: ChronicMedicationAnalytics[];
    insights: string[];
  };
}

interface ChronicRow {
  phase: 'pre' | 'post';
  week: string;
  month: string;
  patient_id: string;
  recommendation: string;
  issue: string | null;
  issue_values: string[] | null;
  medication_name: string;
  consultant: string;
}

const CHRONIC_EXCLUDED_CONSULTANTS = new Set([
  '1 Months',
  '2 Month',
  '3 Months',
  '4 Months',
  '5 Months',
  '6 Months',
]);

const CHRONIC_CONSULTANT =
  "coalesce(nullif(row_data->>'Consultant',''), nullif(row_data->>'consultant',''), nullif(row_data->>'Doctor',''), nullif(row_data->>'Practitioner',''), 'Unassigned')";

const CHRONIC_CARE_CONSULTANT =
  "coalesce(nullif(btrim(row_data->>'Consultant Name'), ''), 'Unassigned')";

function chronicConsultantOptions(values: Array<string | null | undefined>) {
  const consultants = new Set<string>();
  let hasUnassigned = false;

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (trimmed === 'Unassigned') {
      hasUnassigned = true;
      continue;
    }
    if (CHRONIC_EXCLUDED_CONSULTANTS.has(trimmed)) continue;
    consultants.add(trimmed);
  }

  const options = Array.from(consultants).sort((a, b) => a.localeCompare(b));
  if (hasUnassigned) options.push('Unassigned');
  return options;
}

const CHRONIC_ISSUE_CATALOG_HINTS = [
  'Moderate interaction',
  'To be re-considered i',
  'To be reconsidered if',
  'Cannot be taken as c',
  'exaggerated protocol',
  'Severe Interaction',
  'Mild interaction',
  'Acc. to DAPT score',
  'To be re-considered i',
  'Acc to DAPT score',
  'Contraindicated with',
  'Not related to diagn',
  'Not related to the di',
  'acc. To Frax Score',
];

const CHRONIC_RECOMMENDATION_CATALOG = [
  'As Is',
  'To be re-evaluated',
  'Monitored',
  'To be stopped',
  'Adjusted',
  'Modified',
  'Merged',
  'No Need For Chronic',
  '0',
] as const;

function normalizeRecommendationKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'â€œâ€‌â€کâ€™`]+|["'â€œâ€‌â€کâ€™`]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

const CHRONIC_CANONICAL_RECOMMENDATION_KEYS = CHRONIC_RECOMMENDATION_CATALOG.map(normalizeRecommendationKey);
const chronicRecommendationCanonCache = new Map<string, string>();

function canonicalizeRecommendation(raw?: string | null): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  const cached = chronicRecommendationCanonCache.get(trimmed);
  if (cached !== undefined) return cached;
  const key = normalizeRecommendationKey(trimmed);
  const index = CHRONIC_CANONICAL_RECOMMENDATION_KEYS.indexOf(key);
  const resolved = index >= 0 ? CHRONIC_RECOMMENDATION_CATALOG[index] : trimmed;
  chronicRecommendationCanonCache.set(trimmed, resolved);
  return resolved;
}

function cleanChronicFilter(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function pctChange(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function countDistinct(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function looksLikeIssueColumnName(value: string) {
  return /^issue\d+$/i.test(value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
}

// ── Canonical Issue categories (Sprint 34.2) ─────────────────────────────────
// The system recognises exactly 13 canonical Issue categories. Every extracted
// Issue value is normalized and fuzzy-matched against these 13; a match of
// >= 90% similarity collapses the value to its canonical label so spelling
// variants ("Moderate interactionue", "ISSUE 5 : Moderate interaction",
// "Cannot be taken as Chronic") never spawn extra dropdown options. Values that
// match nothing are kept as-is. Query-layer only — no UI change.
const CHRONIC_CANONICAL_ISSUES = [
  'Acc. to DAPT score',
  'Acc to FRAX score',
  'Acc to MMSE score',
  'Cannot be taken as chronic',
  'Contraindicated with',
  'Dose is decreased for long time use',
  'exaggerated protocol',
  'Mild interaction',
  'Moderate interaction',
  'Not related to the diagnosis',
  'Severe interaction',
  'To be re-considered if the patient still needs it or not',
  '0',
] as const;

const CHRONIC_ISSUE_MATCH_THRESHOLD = 0.9;

// Normalization key (never displayed): trim, strip surrounding quotes, lower-
// case, drop a leading "issue N" prefix, fold ':;,-_' differences to spaces,
// remove other/duplicated punctuation, collapse spaces.
function normalizeIssueKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .toLowerCase()
    .replace(/^\s*issue\s*\d+\s*[:;,\-_.]*\s*/, '')
    .replace(/[:;,\-_]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHRONIC_CANONICAL_ISSUE_KEYS = CHRONIC_CANONICAL_ISSUES.map(normalizeIssueKey);

const CHRONIC_ISSUE_ALIASES = new Map<string, string>([
  ['acc to dapt', 'Acc. to DAPT score'],
  ['acc to dapt score', 'Acc. to DAPT score'],
  ['acc to frax', 'Acc to FRAX score'],
  ['acc to frax score', 'Acc to FRAX score'],
  ['acc to mmse', 'Acc to MMSE score'],
  ['acc to mmse score', 'Acc to MMSE score'],
  ['cannot be taken as c', 'Cannot be taken as chronic'],
  ['cannot be taken as chronic', 'Cannot be taken as chronic'],
  ['contraindicated with', 'Contraindicated with'],
  ['dose decreased for long time use', 'Dose decreased for long time use'],
  ['exaggerated protocol', 'exaggerated protocol'],
  ['mild interaction', 'Mild interaction'],
  ['moderate interaction', 'Moderate interaction'],
  ['not related to diagn', 'Not related to the diagnosis'],
  ['not related to diagnosis', 'Not related to the diagnosis'],
  ['not related to the di', 'Not related to the diagnosis'],
  ['not related to the diagnosis', 'Not related to the diagnosis'],
  ['severe interaction', 'Severe interaction'],
  ['to be considered i', 'To be re-considered if the patient still needs it or not'],
  ['to be re considered i', 'To be re-considered if the patient still needs it or not'],
  ['to be re considered if', 'To be re-considered if the patient still needs it or not'],
  ['to be reconsidered i', 'To be re-considered if the patient still needs it or not'],
  ['to be reconsidered if', 'To be re-considered if the patient still needs it or not'],
  ['to be reconsidered it', 'To be re-considered if the patient still needs it or not'],
  ['0', '0'],
]);

// Levenshtein distance (iterative, single row) → similarity ratio in [0,1].
function issueEditDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[n];
}

function issueSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - issueEditDistance(a, b) / longest : 1;
}

// Memoized: there are only a handful of distinct raw spellings across ~33k rows.
const chronicIssueCanonCache = new Map<string, string>();

function canonicalizeIssue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const cached = chronicIssueCanonCache.get(trimmed);
  if (cached !== undefined) return cached;
  const key = normalizeIssueKey(trimmed);
  const alias = CHRONIC_ISSUE_ALIASES.get(key);
  if (alias) {
    chronicIssueCanonCache.set(trimmed, alias);
    return alias;
  }
  let best = trimmed;
  let bestScore = 0;
  if (key) {
    for (let i = 0; i < CHRONIC_CANONICAL_ISSUES.length; i += 1) {
      const score = issueSimilarity(key, CHRONIC_CANONICAL_ISSUE_KEYS[i]);
      if (score > bestScore) {
        bestScore = score;
        best = CHRONIC_CANONICAL_ISSUES[i];
      }
    }
  }
  const resolved = bestScore >= CHRONIC_ISSUE_MATCH_THRESHOLD ? best : trimmed;
  chronicIssueCanonCache.set(trimmed, resolved);
  return resolved;
}

function issueValues(row: ChronicRow) {
  const values = Array.isArray(row.issue_values) ? row.issue_values : [];
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && !looksLikeIssueColumnName(value))
    .map((value) => canonicalizeIssue(value));
}

function normalizedCatalogLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function orderCatalog(options: string[], hints: readonly string[]) {
  const remaining = [...new Set(options.filter(Boolean))];
  const ordered: string[] = [];
  for (const hint of hints) {
    const normalizedHint = normalizedCatalogLabel(hint);
    const index = remaining.findIndex((option) => {
      const normalizedOption = normalizedCatalogLabel(option);
      return normalizedOption === normalizedHint ||
        normalizedOption.startsWith(normalizedHint) ||
        normalizedHint.startsWith(normalizedOption);
    });
    if (index >= 0) {
      ordered.push(remaining[index]);
      remaining.splice(index, 1);
    } else if (!ordered.includes(hint)) {
      ordered.push(hint);
    }
  }
  return [...ordered, ...remaining.sort((a, b) => a.localeCompare(b))];
}

function improvementPct(pre: number, post: number) {
  if (!pre && !post) return 0;
  if (!pre) return post ? -100 : 0;
  return Number((((pre - post) / pre) * 100).toFixed(1));
}

function phaseMetrics(rows: ChronicRow[], phase: 'pre' | 'post') {
  const phaseRows = rows.filter((row) => row.phase === phase);
  const patients = countDistinct(phaseRows.map((row) => row.patient_id));
  const medications = phaseRows.length;
  const issues = phaseRows.reduce((sum, row) => sum + issueValues(row).length, 0);
  const recommendations = phaseRows.filter((row) => row.recommendation).length;
  const per = (count: number) => patients ? Number((count / patients).toFixed(2)) : 0;
  return {
    patients,
    medications,
    issues,
    recommendations,
    avgMedications: per(medications),
    avgIssues: per(issues),
    avgRecommendations: per(recommendations),
  };
}

function comparisonMetric(label: string, pre: number, post: number, decimals = 0): ChronicComparisonMetric {
  return {
    label,
    pre,
    post,
    difference: Number((post - pre).toFixed(decimals)),
    improvementPct: improvementPct(pre, post),
    decimals,
  };
}

function buildComparisonMetrics(rows: ChronicRow[]) {
  const pre = phaseMetrics(rows, 'pre');
  const post = phaseMetrics(rows, 'post');
  return [
    comparisonMetric('Patients', pre.patients, post.patients),
    comparisonMetric('Medications', pre.medications, post.medications),
    comparisonMetric('Issues', pre.issues, post.issues),
    comparisonMetric('Recommendations', pre.recommendations, post.recommendations),
    comparisonMetric('Average Medications / Patient', pre.avgMedications, post.avgMedications, 2),
    comparisonMetric('Average Issues / Patient', pre.avgIssues, post.avgIssues, 2),
    comparisonMetric('Average Recommendations / Patient', pre.avgRecommendations, post.avgRecommendations, 2),
  ];
}

function buildOutcomeTrendPoints(periods: string[], rowsByPeriod: Map<string, ChronicRow[]>): ChronicOutcomeTrendPoint[] {
  return periods.map((period) => {
    const rows = rowsByPeriod.get(period) ?? [];
    const pre = phaseMetrics(rows, 'pre');
    const post = phaseMetrics(rows, 'post');
    return {
      period,
      preIssuesPerPatient: pre.avgIssues,
      postIssuesPerPatient: post.avgIssues,
      issueImprovementPct: improvementPct(pre.avgIssues, post.avgIssues),
      preRecommendationsPerPatient: pre.avgRecommendations,
      postRecommendationsPerPatient: post.avgRecommendations,
      recommendationImprovementPct: improvementPct(pre.avgRecommendations, post.avgRecommendations),
    };
  });
}

function catalogComparison(rows: ChronicRow[], catalog: readonly string[], key: 'issue' | 'recommendation'): ChronicCatalogComparison[] {
  const preCounts = labelCounts(rows.filter((row) => row.phase === 'pre'), key);
  const postCounts = labelCounts(rows.filter((row) => row.phase === 'post'), key);
  return catalog.map((label) => {
    const pre = preCounts.get(label) ?? 0;
    const post = postCounts.get(label) ?? 0;
    return {
      label,
      pre,
      post,
      difference: post - pre,
      improvementPct: improvementPct(pre, post),
    };
  });
}

function buildOperationalKpis(rows: ChronicRow[]): ChronicOperationalKpis {
  const post = rows.filter((row) => row.phase === 'post');
  const waitingLab = post.filter((row) => {
    const haystack = `${issueValues(row).join(' ')} ${row.recommendation ?? ''}`.toLowerCase();
    return haystack.includes('waiting') || haystack.includes('lab result');
  }).length;
  const noNeedForChronic = post.filter((row) => {
    const haystack = `${issueValues(row).join(' ')} ${row.recommendation ?? ''}`.toLowerCase();
    return haystack.includes('no need for chronic');
  }).length;
  return {
    waitingLab,
    noNeedForChronic,
    noNeedPct: post.length ? Number(((noNeedForChronic / post.length) * 100).toFixed(2)) : 0,
  };
}

// All metrics for one period, computed over BOTH phases of its rows.
// Counting semantics are unchanged from Sprint 33: medication/issue/
// recommendation volumes come from the POST rows (the after-review state);
// the Pre/Post patient split is the movement the module exists to show.
function chronicPeriodMetrics(rows: ChronicRow[]) {
  const post = rows.filter((row) => row.phase === 'post');
  const prePatients = countDistinct(rows.filter((row) => row.phase === 'pre').map((row) => row.patient_id));
  const postPatients = countDistinct(post.map((row) => row.patient_id));
  const patients = postPatients;
  const medications = post.length;
  const issues = post.reduce((sum, row) => sum + issueValues(row).length, 0);
  const recommendations = post.filter((row) => row.recommendation).length;
  const per = (count: number) => (postPatients ? Number((count / postPatients).toFixed(2)) : 0);
  return {
    patients,
    prePatients,
    postPatients,
    medications,
    issues,
    recommendations,
    avgMedications: per(medications),
    avgRecommendations: per(recommendations),
    avgIssues: per(issues),
  };
}

function labelCounts(rows: ChronicRow[], key: 'issue' | 'recommendation') {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const labels = key === 'issue' ? issueValues(row) : [canonicalizeRecommendation(row.recommendation)];
    for (const label of labels) {
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

// Ranked list for the current period: count, share of the period total, and
// direction vs the same label's count in the previous period.
function rankWithTrend(current: ChronicRow[], previous: ChronicRow[], key: 'issue' | 'recommendation', limit = 8): ChronicRankedItem[] {
  const currentCounts = labelCounts(current, key);
  const previousCounts = labelCounts(previous, key);
  const total = Array.from(currentCounts.values()).reduce((sum, count) => sum + count, 0);
  return Array.from(currentCounts.entries())
    .map(([label, value]) => {
      const before = previousCounts.get(label) ?? 0;
      return {
        label,
        value,
        pct: total ? Number(((value / total) * 100).toFixed(1)) : 0,
        trend: value > before ? 'up' as const : value < before ? 'down' as const : 'flat' as const,
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function moverPct(previous: number, current: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

// Biggest movers: current period vs previous period (POST rows). An
// improvement is an issue falling or a recommendation rising; a regression is
// the opposite. Returns the single largest of each.
function buildPeriodMovers(currentPost: ChronicRow[], previousPost: ChronicRow[]) {
  const movers: ChronicMover[] = [];
  for (const key of ['issue', 'recommendation'] as const) {
    const currentCounts = labelCounts(currentPost, key);
    const previousCounts = labelCounts(previousPost, key);
    const labels = new Set([...currentCounts.keys(), ...previousCounts.keys()]);
    for (const label of labels) {
      const current = currentCounts.get(label) ?? 0;
      const previous = previousCounts.get(label) ?? 0;
      if (current === previous) continue;
      movers.push({
        label,
        type: key === 'issue' ? 'Issue' : 'Recommendation',
        previous,
        current,
        delta: current - previous,
        pct: moverPct(previous, current),
      });
    }
  }
  const byMagnitude = (a: ChronicMover, b: ChronicMover) => Math.abs(b.delta) - Math.abs(a.delta) || Math.abs(b.pct) - Math.abs(a.pct);
  const improvement = movers
    .filter((row) => (row.type === 'Issue' ? row.delta < 0 : row.delta > 0))
    .sort(byMagnitude)[0] ?? null;
  const regression = movers
    .filter((row) => (row.type === 'Issue' ? row.delta > 0 : row.delta < 0))
    .sort(byMagnitude)[0] ?? null;
  return { improvement, regression };
}

function buildIssuePareto(rows: ChronicRow[], limit = 12): ChronicParetoItem[] {
  const counts = labelCounts(rows, 'issue');
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  let cumulative = 0;
  let reachedTarget = false;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => {
      const inPareto = !reachedTarget;
      cumulative += value;
      const cumulativePct = total ? Number(((cumulative / total) * 100).toFixed(1)) : 0;
      if (cumulativePct >= 80) reachedTarget = true;
      return {
        label,
        value,
        pct: total ? Number(((value / total) * 100).toFixed(1)) : 0,
        cumulativePct,
        inPareto,
      };
    });
}

function buildRecommendationAcceptance(rows: ChronicRow[], limit = 10): ChronicRecommendationAcceptance[] {
  const preCounts = labelCounts(rows.filter((row) => row.phase === 'pre'), 'recommendation');
  const postCounts = labelCounts(rows.filter((row) => row.phase === 'post'), 'recommendation');
  const labels = new Set([...preCounts.keys(), ...postCounts.keys()]);
  return Array.from(labels)
    .map((label) => {
      const pre = preCounts.get(label) ?? 0;
      const post = postCounts.get(label) ?? 0;
      return {
        label,
        pre,
        post,
        acceptancePct: pre ? Number(((post / pre) * 100).toFixed(1)) : post ? 100 : 0,
      };
    })
    .sort((a, b) => b.post - a.post || b.acceptancePct - a.acceptancePct || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildDimensionBreakdown(rows: ChronicRow[], getLabel: (row: ChronicRow) => string | null | undefined, limit = 10): ChronicBreakdownItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = getLabel(row)?.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  return Array.from(counts.entries())
    .map(([label, value]) => ({
      label,
      value,
      pct: total ? Number(((value / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildWeightedDimensionBreakdown(rows: ChronicRow[], getLabel: (row: ChronicRow) => string | null | undefined, getWeight: (row: ChronicRow) => number, limit = 10): ChronicBreakdownItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = getLabel(row)?.trim();
    if (!label) continue;
    const weight = getWeight(row);
    if (!weight) continue;
    counts.set(label, (counts.get(label) ?? 0) + weight);
  }
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  return Array.from(counts.entries())
    .map(([label, value]) => ({
      label,
      value,
      pct: total ? Number(((value / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildPeriodBreakdown(points: ChronicTrendPoint[], key: 'issues' | 'recommendations'): ChronicBreakdownItem[] {
  const total = points.reduce((sum, point) => sum + point[key], 0);
  return points.map((point) => ({
    label: point.period,
    value: point[key],
    pct: total ? Number(((point[key] / total) * 100).toFixed(1)) : 0,
  }));
}

function buildIssueSeverity(rows: ChronicRow[]): ChronicBreakdownItem[] {
  const issues = buildDimensionBreakdown(rows, (row) => row.issue, 1000);
  const buckets = new Map([
    ['High', 0],
    ['Medium', 0],
    ['Low', 0],
  ]);
  for (const issue of issues) {
    const bucket = issue.pct >= 20 ? 'High' : issue.pct >= 10 ? 'Medium' : 'Low';
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + issue.value);
  }
  const total = Array.from(buckets.values()).reduce((sum, count) => sum + count, 0);
  return Array.from(buckets.entries())
    .map(([label, value]) => ({
      label,
      value,
      pct: total ? Number(((value / total) * 100).toFixed(1)) : 0,
    }))
    .filter((row) => row.value > 0);
}

function buildCorrelationPairs(rows: ChronicRow[], limit = 12): ChronicCorrelationPair[] {
  const counts = new Map<string, { issue: string; recommendation: string; value: number }>();
  for (const row of rows) {
    const recommendation = canonicalizeRecommendation(row.recommendation);
    if (!recommendation) continue;
    for (const issue of issueValues(row)) {
      const key = `${issue}\u0000${recommendation}`;
      const current = counts.get(key) ?? { issue, recommendation, value: 0 };
      current.value += 1;
      counts.set(key, current);
    }
  }
  const total = Array.from(counts.values()).reduce((sum, row) => sum + row.value, 0);
  return Array.from(counts.values())
    .map((row) => ({
      ...row,
      pct: total ? Number(((row.value / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.issue.localeCompare(b.issue) || a.recommendation.localeCompare(b.recommendation))
    .slice(0, limit);
}

function issueImprovementPct(currentIssues: number, previousIssues: number) {
  if (!previousIssues) return 0;
  const value = ((previousIssues - currentIssues) / previousIssues) * 100;
  return Number(Math.max(0, value).toFixed(1));
}

function buildAnalyticsKpis(current: ReturnType<typeof chronicPeriodMetrics>, previous: ReturnType<typeof chronicPeriodMetrics>, rows: ChronicRow[]): ChronicAnalyticsKpi[] {
  const preRecommendations = rows.filter((row) => row.phase === 'pre' && row.recommendation).length;
  const acceptancePct = preRecommendations ? Number(((current.recommendations / preRecommendations) * 100).toFixed(1)) : current.recommendations ? 100 : 0;
  const issueDensity = current.medications ? Number(((current.issues / current.medications) * 100).toFixed(1)) : 0;
  return [
    { label: 'Total Issues', value: current.issues },
    { label: 'Total Recommendations', value: current.recommendations },
    { label: 'Recommendation Acceptance', value: acceptancePct, suffix: '%', decimals: 1 },
    { label: 'Issue Density', value: issueDensity, suffix: '%', decimals: 1 },
    { label: 'Recommendations / Patient', value: current.avgRecommendations, decimals: 2 },
    { label: 'Issues / Patient', value: current.avgIssues, decimals: 2 },
    { label: 'Improvement', value: issueImprovementPct(current.issues, previous.issues), suffix: '%', decimals: 1 },
  ];
}

function buildConsultantAnalytics(rows: ChronicRow[], previousRows: ChronicRow[], limit = 1000): ChronicConsultantAnalytics[] {
  const groups = new Map<string, ChronicRow[]>();
  for (const row of rows) {
    const label = row.consultant || 'Unassigned';
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  const previousGroups = new Map<string, ChronicRow[]>();
  for (const row of previousRows) {
    const label = row.consultant || 'Unassigned';
    previousGroups.set(label, [...(previousGroups.get(label) ?? []), row]);
  }
  const totalRecommendations = rows.filter((row) => row.phase === 'post' && row.recommendation).length;
  const totalIssues = rows.filter((row) => row.phase === 'post').reduce((sum, row) => sum + issueValues(row).length, 0);
  return Array.from(groups.entries())
    .map(([label, group]) => {
      const post = group.filter((row) => row.phase === 'post');
      const previousPost = (previousGroups.get(label) ?? []).filter((row) => row.phase === 'post');
      const patients = countDistinct(group.map((row) => row.patient_id));
      const postPatients = countDistinct(post.map((row) => row.patient_id));
      const medications = post.filter((row) => row.medication_name).length;
      const recommendations = post.filter((row) => row.recommendation).length;
      const issues = post.reduce((sum, row) => sum + issueValues(row).length, 0);
      const previousIssues = previousPost.reduce((sum, row) => sum + issueValues(row).length, 0);
      return {
        label,
        patients,
        recommendations,
        issues,
        recommendationPct: totalRecommendations ? Number(((recommendations / totalRecommendations) * 100).toFixed(1)) : 0,
        issuePct: totalIssues ? Number(((issues / totalIssues) * 100).toFixed(1)) : 0,
        avgMedications: postPatients ? Number((medications / postPatients).toFixed(2)) : 0,
        improvementPct: issueImprovementPct(issues, previousIssues),
      };
    })
    .sort((a, b) => b.patients - a.patients || b.recommendations - a.recommendations || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildMedicationAnalytics(rows: ChronicRow[], limit = 1000): ChronicMedicationAnalytics[] {
  const groups = new Map<string, ChronicRow[]>();
  for (const row of rows) {
    const label = row.medication_name?.trim();
    if (!label) continue;
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([label, group]) => {
      const medications = group.length;
      const issues = group.reduce((sum, row) => sum + issueValues(row).length, 0);
      const topIssueLabels = Array.from(labelCounts(group, 'issue').entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([issue]) => issue);
      return {
        label,
        medications,
        recommendations: group.filter((row) => row.recommendation).length,
        issues,
        issueRate: medications ? Number(((issues / medications) * 100).toFixed(1)) : 0,
        recommendationRate: medications ? Number(((group.filter((row) => row.recommendation).length / medications) * 100).toFixed(1)) : 0,
        topIssues: topIssueLabels,
        topRecommendations: buildDimensionBreakdown(group, (row) => canonicalizeRecommendation(row.recommendation), 3).map((row) => row.label),
      };
    })
    .sort((a, b) => b.medications - a.medications || b.issueRate - a.issueRate || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildChronicInsights({
  topIssues,
  topRecommendations,
  issueByConsultant,
  issueByMedication,
  recommendationByMedication,
  trends,
  correlations,
}: {
  topIssues: ChronicRankedItem[];
  topRecommendations: ChronicRankedItem[];
  issueByConsultant: ChronicBreakdownItem[];
  issueByMedication: ChronicBreakdownItem[];
  recommendationByMedication: ChronicBreakdownItem[];
  trends: ChronicTrendPoint[];
  correlations: ChronicCorrelationPair[];
}) {
  const insights: string[] = [];
  if (issueByConsultant[0]) insights.push(`Most issues came from ${issueByConsultant[0].label} at ${issueByConsultant[0].pct.toFixed(1)}% of visible issues.`);
  if (topRecommendations[0]) {
    const direction = topRecommendations[0].trend === 'up' ? 'increased' : topRecommendations[0].trend === 'down' ? 'decreased' : 'remained stable';
    insights.push(`${topRecommendations[0].label} ${direction} versus the previous period.`);
  }
  if (topIssues[0]) {
    const direction = topIssues[0].trend === 'down' ? 'decreased' : topIssues[0].trend === 'up' ? 'increased' : 'remained stable';
    insights.push(`${topIssues[0].label} issues ${direction} versus the previous period.`);
  }
  if (issueByMedication[0]) insights.push(`${issueByMedication[0].label} has the highest issue volume among visible medications.`);
  if (recommendationByMedication[0]) insights.push(`${recommendationByMedication[0].label} has the highest recommendation volume among visible medications.`);
  if (correlations[0]) insights.push(`${correlations[0].issue} most commonly maps to ${correlations[0].recommendation}.`);
  if (trends.length >= 2) {
    const first = trends[0];
    const last = trends[trends.length - 1];
    const delta = last.issues - first.issues;
    if (delta) insights.push(`Issue volume ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toLocaleString()} across the visible period range.`);
  }
  return insights.slice(0, 6);
}

function describeChange(label: string, pct: number, directionLabel?: { up: string; down: string; flat: string }) {
  if (Math.abs(pct) < 1) return `${label} ${directionLabel?.flat ?? 'remained stable'}.`;
  const verb = pct > 0 ? (directionLabel?.up ?? 'increased') : (directionLabel?.down ?? 'decreased');
  return `${label} ${verb} ${Math.abs(pct).toFixed(0)}% compared with the previous period.`;
}

// Single source of truth for the business calendar: read from the DB table
// healpath.chronic_calendar. Falls back to the bundled seed when the table is
// absent (no import has run yet) or the DB is unavailable — so the dashboard is
// always correct, and new weeks appear the moment they are added to the table.
export async function getChronicCalendar(): Promise<ChronicCalendarEntry[]> {
  if (!hasDb) return CHRONIC_CALENDAR_SEED;
  try {
    const rows = await dbQuery<{ week: number | string; month_name: string; year: number | string; month_order: number | string; period: string }>(
      'select week, month_name, year, month_order, period from healpath.chronic_calendar order by month_order, week',
    );
    if (!rows.length) return CHRONIC_CALENDAR_SEED;
    return rows.map((row) => ({
      week: Number(row.week),
      month_name: row.month_name,
      year: Number(row.year),
      month_order: Number(row.month_order),
      period: row.period,
    }));
  } catch {
    return CHRONIC_CALENDAR_SEED;
  }
}

const CHRONIC_KPI_LABELS = [
  'Patients',
  'Pre Patients',
  'Post Patients',
  'Medications',
  'Recommendations',
  'Issues',
  'Avg Medications / Patient',
  'Avg Recommendations / Patient',
  'Avg Issues / Patient',
] as const;

function emptyChronicData(filters: Required<ChronicOverviewFilters>): ChronicOverviewData {
  return {
    filters,
    options: { periods: [], weeks: [], consultants: [], recommendations: [], issues: [], medications: [] },
    currentPeriod: null,
    previousPeriod: null,
    kpis: CHRONIC_KPI_LABELS.map((label) => ({
      label,
      value: 0,
      deltaPct: 0,
      decimals: label.startsWith('Avg') ? 2 : 0,
      trend: [],
    })),
    summary: ['No chronic import data is available for the selected filters.'],
    alerts: [],
    trends: [],
    topIssues: [],
    topRecommendations: [],
    movers: { improvement: null, regression: null },
    prePost: {
      metrics: [],
      outcomeTrends: [],
      issueCatalog: catalogComparison([], CHRONIC_CANONICAL_ISSUES, 'issue'),
      recommendationCatalog: catalogComparison([], CHRONIC_RECOMMENDATION_CATALOG, 'recommendation'),
      operational: { waitingLab: 0, noNeedForChronic: 0, noNeedPct: 0 },
    },
    analytics: {
      kpis: [],
      issuePareto: [],
      issueSeverity: [],
      issueByConsultant: [],
      issueByMedication: [],
      issueByPeriod: [],
      recommendationAcceptance: [],
      recommendationByConsultant: [],
      recommendationByMedication: [],
      recommendationByPeriod: [],
      correlations: [],
      consultants: [],
      medications: [],
      insights: [],
    },
  };
}

export async function getChronicOverview(filters: ChronicOverviewFilters): Promise<ChronicOverviewData> {
  const recommendationFilter = cleanChronicFilter(filters.recommendation);
  const f = {
    period: cleanChronicFilter(filters.period),
    consultant: cleanChronicFilter(filters.consultant),
    recommendation: recommendationFilter ? canonicalizeRecommendation(recommendationFilter) : null,
    issue: cleanChronicFilter(filters.issue),
    medication: cleanChronicFilter(filters.medication),
    patient: cleanChronicFilter(filters.patient),
  };
  const recommendationFilterKey = f.recommendation ? normalizeRecommendationKey(f.recommendation) : null;
  const normalized = {
    period: f.period ?? '',
    consultant: f.consultant ?? '',
    recommendation: f.recommendation ?? '',
    issue: f.issue ?? '',
    medication: f.medication ?? '',
    patient: f.patient ?? '',
  };
  if (!hasDb) return emptyChronicData(normalized);

  // Period is the primary timeline. Rows are fetched for ALL periods (with the
  // other filters bound) in one query; the selected period then scopes the
  // current-period analytics in memory. This keeps a single query AND makes
  // "delta vs previous period" work even while a period filter is active.
  const calendar = await getChronicCalendar();

  try {
    const rows = await dbQuery<ChronicRow>(`
      with chronic as (
        select 'pre'::text as phase, week, month, btrim(patient_id) as patient_id, recommendation, issue, medication_name, row_data, ${CHRONIC_CARE_CONSULTANT} as consultant
        from healpath.chronic_pre
        union all
        select 'post'::text as phase, week, month, btrim(patient_id) as patient_id, recommendation, issue, medication_name, row_data, ${CHRONIC_CARE_CONSULTANT} as consultant
        from healpath.chronic_post
      )
      select phase, week, month, patient_id, recommendation, issue, medication_name, consultant,
        coalesce(issue_extract.issue_values, array[]::text[]) as issue_values
      from chronic
      left join lateral (
        select array_agg(issue_value order by issue_number, issue_key) as issue_values
        from (
          select
            issue_entry.key as issue_key,
            (regexp_match(regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g'), '^issue([0-9]+)'))[1]::int as issue_number,
            btrim(issue_entry.value) as issue_value
          from jsonb_each_text(row_data::jsonb) as issue_entry(key, value)
          where regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g') ~ '^issue[0-9]+'
            and btrim(issue_entry.value) <> ''
            and regexp_replace(lower(btrim(issue_entry.value)), '[^a-z0-9]', '', 'g') !~ '^issue[0-9]+$'
        ) issue_columns
      ) issue_extract on true
      where ($1::text is null or consultant = $1)
        and ($2::text is null or regexp_replace(lower(btrim(recommendation)), '[^a-z0-9]+', '', 'g') = $2)
        and ($3::text is null or patient_id ilike '%' || $3 || '%')
      order by week, phase, patient_id
    `, [f.consultant, recommendationFilterKey, f.patient]);
    const canonicalRows = rows.map((row) => ({ ...row, recommendation: canonicalizeRecommendation(row.recommendation) }));
    // Filter by the CANONICAL issue so a selected canonical option (and legacy
    // raw values in bookmarked URLs) match rows whose values are now canonical.
    const targetIssue = f.issue ? canonicalizeIssue(f.issue) : null;
    const filteredRows = targetIssue ? canonicalRows.filter((row) => issueValues(row).includes(targetIssue)) : canonicalRows;

    // The visible Period options come from the DB calendar, restricted to the
    // weeks present in the data and ordered chronologically. Weeks stay internal.
    const uniq = (values: Array<string | null | undefined>) => Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b));
    const presentWeeks = uniq(filteredRows.map((row) => row.week));
    const medicationOptions = Array.from(new Set(filteredRows.map((row) => row.medication_name?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b));
    const options = {
      periods: chronicPeriodsForWeeks(calendar, presentWeeks).map((entry) => entry.period),
      weeks: presentWeeks,
      consultants: chronicConsultantOptions(filteredRows.map((row) => row.consultant)),
      recommendations: uniq(filteredRows.map((row) => canonicalizeRecommendation(row.recommendation))),
      issues: uniq(filteredRows.flatMap((row) => issueValues(row))),
      medications: medicationOptions,
    };
    if (!filteredRows.length) return { ...emptyChronicData(normalized), options };
    const scopedRows = f.medication
      ? filteredRows.filter((row) => row.medication_name?.trim() === f.medication)
      : filteredRows;

    // Group rows by business-calendar period, ordered chronologically. Rows
    // whose week is not in the calendar (legacy test data) are excluded.
    const rowsByPeriod = new Map<string, ChronicRow[]>();
    const periodMeta = new Map<string, { order: number; ym: string }>();
    for (const row of scopedRows) {
      const entry = chronicEntryForWeek(calendar, row.week);
      if (!entry) continue;
      if (!rowsByPeriod.has(entry.period)) {
        rowsByPeriod.set(entry.period, []);
        periodMeta.set(entry.period, { order: entry.month_order, ym: chronicYm(entry.month_name, entry.year) });
      }
      rowsByPeriod.get(entry.period)!.push(row);
    }
    const periods = Array.from(rowsByPeriod.keys())
      .sort((a, b) => (periodMeta.get(a)!.order) - (periodMeta.get(b)!.order));
    if (!periods.length) return { ...emptyChronicData(normalized), options };

    // All means all calendar-mapped rows. Only an explicit Period selection
    // scopes KPI math to a single period; there is no hidden latest-period default.
    const selectedPeriod = f.period && periods.includes(f.period) ? f.period : null;
    const currentPeriod = selectedPeriod;
    const previousPeriod = selectedPeriod ? periods[periods.indexOf(selectedPeriod) - 1] ?? null : null;
    const currentRows = selectedPeriod
      ? rowsByPeriod.get(selectedPeriod) ?? []
      : scopedRows;
    const previousRows = previousPeriod ? rowsByPeriod.get(previousPeriod) ?? [] : [];
    const currentPost = currentRows.filter((row) => row.phase === 'post');
    const previousPost = previousRows.filter((row) => row.phase === 'post');
    const currentMetrics = chronicPeriodMetrics(currentRows);
    const previousMetrics = chronicPeriodMetrics(previousRows);
    const issueCatalog = Array.from(CHRONIC_CANONICAL_ISSUES);
    const recommendationCatalog = Array.from(CHRONIC_RECOMMENDATION_CATALOG);

    const trends: ChronicTrendPoint[] = periods.map((period) => ({
      week: period,
      month: periodMeta.get(period)!.ym,
      period,
      ...chronicPeriodMetrics(rowsByPeriod.get(period) ?? []),
    }));

    const pop = (current: number, previous: number) => previousPeriod ? pctChange(current, previous) : 0;
    const metricKeys = ['patients', 'prePatients', 'postPatients', 'medications', 'recommendations', 'issues', 'avgMedications', 'avgRecommendations', 'avgIssues'] as const;
    const kpis: ChronicKpiMetric[] = CHRONIC_KPI_LABELS.map((label, index) => {
      const key = metricKeys[index];
      return {
        label,
        value: currentMetrics[key],
        deltaPct: pop(currentMetrics[key], previousMetrics[key]),
        decimals: label.startsWith('Avg') ? 2 : 0,
        trend: trends.map((point) => point[key]),
      };
    });

    const issuePct = pop(currentMetrics.issues, previousMetrics.issues);
    const recommendationPct = pop(currentMetrics.recommendations, previousMetrics.recommendations);
    const medicationLoadPct = pop(currentMetrics.avgMedications, previousMetrics.avgMedications);
    const patientPct = pop(currentMetrics.patients, previousMetrics.patients);
    const summary = [
      describeChange('Issues', issuePct),
      describeChange('Recommendations', recommendationPct, { up: 'increased', down: 'decreased', flat: 'remained stable' }),
      describeChange('Medication load', medicationLoadPct, { up: 'increased', down: 'decreased', flat: 'remained stable' }),
      describeChange('Patient volume', patientPct, { up: 'grew', down: 'contracted', flat: 'remained stable' }),
    ];

    const topIssues = rankWithTrend(currentPost, previousPost, 'issue', 10);
    const topRecommendations = rankWithTrend(currentPost, previousPost, 'recommendation', 10);
    const movers = buildPeriodMovers(currentPost, previousPost);
    const issueByConsultant = buildWeightedDimensionBreakdown(currentPost, (row) => row.consultant, (row) => issueValues(row).length);
    const issueByMedication = buildWeightedDimensionBreakdown(currentPost, (row) => row.medication_name, (row) => issueValues(row).length);
    const recommendationByConsultant = buildDimensionBreakdown(currentPost, (row) => row.recommendation ? row.consultant : null);
    const recommendationByMedication = buildDimensionBreakdown(currentPost, (row) => row.recommendation ? row.medication_name : null);
    const correlations = buildCorrelationPairs(currentPost);
    const analytics = {
      kpis: buildAnalyticsKpis(currentMetrics, previousMetrics, currentRows),
      issuePareto: buildIssuePareto(currentPost),
      issueSeverity: buildIssueSeverity(currentPost),
      issueByConsultant,
      issueByMedication,
      issueByPeriod: buildPeriodBreakdown(trends, 'issues'),
      recommendationAcceptance: buildRecommendationAcceptance(currentRows),
      recommendationByConsultant,
      recommendationByMedication,
      recommendationByPeriod: buildPeriodBreakdown(trends, 'recommendations'),
      correlations,
      consultants: buildConsultantAnalytics(currentRows, previousRows),
      medications: buildMedicationAnalytics(currentPost),
      insights: buildChronicInsights({
        topIssues,
        topRecommendations,
        issueByConsultant,
        issueByMedication,
        recommendationByMedication,
        trends,
        correlations,
      }),
    };
    const prePost = {
      metrics: buildComparisonMetrics(currentRows),
      outcomeTrends: buildOutcomeTrendPoints(periods, rowsByPeriod),
      issueCatalog: catalogComparison(currentRows, issueCatalog, 'issue'),
      recommendationCatalog: catalogComparison(currentRows, recommendationCatalog, 'recommendation'),
      operational: buildOperationalKpis(currentRows),
    };

    // Exactly four executive alerts: the dominant issue and recommendation of
    // the current period, plus the biggest period-over-period mover each way.
    const alerts: ChronicAlert[] = [];
    if (topIssues[0]) {
      alerts.push({ title: 'Highest Issue', label: topIssues[0].label, detail: `${topIssues[0].value.toLocaleString()} occurrences (${topIssues[0].pct}%)`, tone: 'bad' });
    }
    if (topRecommendations[0]) {
      alerts.push({ title: 'Highest Recommendation', label: topRecommendations[0].label, detail: `${topRecommendations[0].value.toLocaleString()} occurrences (${topRecommendations[0].pct}%)`, tone: 'good' });
    }
    if (movers.improvement) {
      const m = movers.improvement;
      alerts.push({ title: 'Highest Improvement', label: m.label, detail: `${m.type} ${m.delta > 0 ? 'up' : 'down'} ${Math.abs(m.pct).toFixed(0)}% vs previous period`, tone: 'good' });
    }
    if (movers.regression) {
      const m = movers.regression;
      alerts.push({ title: 'Largest Regression', label: m.label, detail: `${m.type} ${m.delta > 0 ? 'up' : 'down'} ${Math.abs(m.pct).toFixed(0)}% vs previous period`, tone: 'bad' });
    }

    return {
      filters: normalized,
      options,
      currentPeriod,
      previousPeriod,
      kpis,
      summary,
      alerts,
      trends,
      topIssues,
      topRecommendations,
      movers,
      prePost,
      analytics,
    };
  } catch (e) {
    console.warn('getChronicOverview live query failed:', (e as Error).message);
    return emptyChronicData(normalized);
  }
}

/* ============================================================================
   Sprint 36 — optimized /chronic page path.

   The page previously called getChronicOverview, which ships EVERY chronic row
   (~66k, each with a jsonb_each_text lateral) to Node and aggregates in JS —
   measured at ~100s cold / ~36s warm. The page only consumes filter options,
   currentPeriod, and the prePost datasets, so this path computes exactly those
   with SQL AGGREGATION ONLY: no query returns more than a few hundred compact
   rows, row_data never leaves the database, and the section queries run in
   parallel. Results are byte-identical to the getChronicOverview subsets (the
   same derivation helpers are reused on the aggregated counts).
   getChronicOverview itself is unchanged and still serves /chronic/analytics.
   ========================================================================== */

const CHRONIC_PAGE_CTE = `
  with chronic as (
    select 'pre'::text as phase, week, btrim(patient_id) as patient_id, recommendation, medication_name, row_data, ${CHRONIC_CARE_CONSULTANT} as consultant
    from healpath.chronic_pre
    union all
    select 'post'::text as phase, week, btrim(patient_id) as patient_id, recommendation, medication_name, row_data, ${CHRONIC_CARE_CONSULTANT} as consultant
    from healpath.chronic_post
  )`;

// Issue-field predicates — identical to the getChronicOverview lateral.
const CHRONIC_ISSUE_KEY = "regexp_replace(lower(btrim(e.key)), '[^a-z0-9]', '', 'g') ~ '^issue[0-9]+'";
const CHRONIC_ISSUE_VALUE = "btrim(e.value) <> '' and regexp_replace(lower(btrim(e.value)), '[^a-z0-9]', '', 'g') !~ '^issue[0-9]+$'";

// Shared filter clause: $1 consultant, $2 recommendation, $3 patient,
// $4 raw-spelling variants of the selected canonical issue (null = no filter).
const CHRONIC_PAGE_WHERE = `
      ($1::text is null or c.consultant = $1)
      and ($2::text is null or regexp_replace(lower(btrim(c.recommendation)), '[^a-z0-9]+', '', 'g') = $2)
      and ($3::text is null or c.patient_id ilike '%' || $3 || '%')
      and ($4::text[] is null or exists (
        select 1 from jsonb_each_text(c.row_data) e(key, value)
        where ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE} and btrim(e.value) = any($4::text[])
      ))`;

const CHRONIC_CALENDAR_JOIN =
  "left join healpath.chronic_calendar cal on cal.week = nullif((regexp_match(c.week, '[0-9]+'))[1], '')::int";

interface ChronicPhasePeriodRow {
  is_total: number;
  phase: 'pre' | 'post';
  period: string | null;
  month_order: number | null;
  patients: number;
  medications: number;
  recommendations: number;
  issues: number;
}

interface ChronicLabelCountRow { phase: 'pre' | 'post'; period: string | null; raw_value: string; n: number }
interface ChronicOperationalRow { period: string | null; total: number; waiting: number; no_need: number }
type ChronicPhaseAggregateRow = Omit<ChronicPhasePeriodRow, 'is_total' | 'period' | 'month_order'>;
type ChronicPhaseTrendRow = Omit<ChronicPhasePeriodRow, 'is_total'>;

export interface ChronicKpiDrillRow {
  label: string;
  value: number;
}

export interface ChronicKpiDrillStep {
  title: string;
  rows: ChronicKpiDrillRow[];
}

export type ChronicKpiDrilldowns = Record<string, ChronicKpiDrillStep[]>;

export interface ChronicPageData {
  filters: Required<ChronicOverviewFilters>;
  options: ChronicOverviewData['options'];
  currentPeriod: string | null;
  prePost: ChronicOverviewData['prePost'];
  drilldowns: ChronicKpiDrilldowns;
}

function chronicPhaseTotals(rows: { patients: number; medications: number; recommendations: number; issues: number }[]) {
  const totals = rows.reduce(
    (sum, row) => ({
      patients: sum.patients + row.patients,
      medications: sum.medications + row.medications,
      recommendations: sum.recommendations + row.recommendations,
      issues: sum.issues + row.issues,
    }),
    { patients: 0, medications: 0, recommendations: 0, issues: 0 },
  );
  const per = (count: number) => (totals.patients ? Number((count / totals.patients).toFixed(2)) : 0);
  return { ...totals, avgMedications: per(totals.medications), avgIssues: per(totals.issues), avgRecommendations: per(totals.recommendations) };
}

// Aggregate label counts (per phase) for the requested scope, canonicalizing
// issue spellings exactly like the row-level issueValues() path.
function chronicScopedLabelCounts(rows: ChronicLabelCountRow[], scopePeriod: string | null, canonical: 'issue' | 'recommendation' | null) {
  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  for (const row of rows) {
    if (scopePeriod && row.period !== scopePeriod) continue;
    const label = canonical === 'issue'
      ? canonicalizeIssue(row.raw_value)
      : canonical === 'recommendation'
        ? canonicalizeRecommendation(row.raw_value)
        : row.raw_value.trim();
    if (!label) continue;
    const target = row.phase === 'pre' ? pre : post;
    target.set(label, (target.get(label) ?? 0) + row.n);
  }
  return { pre, post };
}

function chronicCatalogFromCounts(catalog: readonly string[], counts: { pre: Map<string, number>; post: Map<string, number> }): ChronicCatalogComparison[] {
  return catalog.map((label) => {
    const pre = counts.pre.get(label) ?? 0;
    const post = counts.post.get(label) ?? 0;
    return { label, pre, post, difference: post - pre, improvementPct: improvementPct(pre, post) };
  });
}

interface ChronicDrillAggregateRow {
  metric: string;
  dimension: string;
  period: string | null;
  label: string;
  value: number;
}

function chronicDrillRows(rows: ChronicDrillAggregateRow[], metric: string, dimension: string, period: string | null, limit = 10, canonical: 'issue' | 'recommendation' | null = null): ChronicKpiDrillRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.metric !== metric || row.dimension !== dimension) continue;
    if (period && row.period !== period) continue;
    const label = canonical === 'issue'
      ? canonicalizeIssue(row.label)
      : canonical === 'recommendation'
        ? canonicalizeRecommendation(row.label)
        : row.label;
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + Number(row.value));
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildChronicKpiDrilldowns(drillRows: ChronicDrillAggregateRow[], selectedPeriod: string | null): ChronicKpiDrilldowns {
  const steps = (items: Array<[string, ChronicKpiDrillRow[]]>) => items.map(([title, rows]) => ({ title, rows }));
  const patients = steps([
    ['Top Weeks', chronicDrillRows(drillRows, 'patients', 'weeks', selectedPeriod)],
    ['Top Consultants', chronicDrillRows(drillRows, 'patients', 'consultants', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'patients', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'patients', 'medications', selectedPeriod)],
  ]);
  const medications = steps([
    ['Top Weeks', chronicDrillRows(drillRows, 'medications', 'weeks', selectedPeriod)],
    ['Top Consultants', chronicDrillRows(drillRows, 'medications', 'consultants', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'medications', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'medications', 'medications', selectedPeriod)],
  ]);
  const issues = steps([
    ['Top Weeks', chronicDrillRows(drillRows, 'issues', 'weeks', selectedPeriod)],
    ['Top Consultants', chronicDrillRows(drillRows, 'issues', 'consultants', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'issues', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'issues', 'medications', selectedPeriod)],
    ['Top Categories', chronicDrillRows(drillRows, 'issues', 'categories', selectedPeriod, 10, 'issue')],
  ]);
  const recommendations = steps([
    ['Top Categories', chronicDrillRows(drillRows, 'recommendations', 'categories', selectedPeriod, 10, 'recommendation')],
    ['Top Consultants', chronicDrillRows(drillRows, 'recommendations', 'consultants', selectedPeriod)],
    ['Weekly Trend', chronicDrillRows(drillRows, 'recommendations', 'weeks', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'recommendations', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'recommendations', 'medications', selectedPeriod)],
  ]);
  const waitingLab = steps([
    ['Top Weeks', chronicDrillRows(drillRows, 'waitingLab', 'weeks', selectedPeriod)],
    ['Top Consultants', chronicDrillRows(drillRows, 'waitingLab', 'consultants', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'waitingLab', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'waitingLab', 'medications', selectedPeriod)],
  ]);
  const noNeedForChronic = steps([
    ['Top Weeks', chronicDrillRows(drillRows, 'noNeedForChronic', 'weeks', selectedPeriod)],
    ['Top Consultants', chronicDrillRows(drillRows, 'noNeedForChronic', 'consultants', selectedPeriod)],
    ['Top Patients', chronicDrillRows(drillRows, 'noNeedForChronic', 'patients', selectedPeriod)],
    ['Top Medications', chronicDrillRows(drillRows, 'noNeedForChronic', 'medications', selectedPeriod)],
  ]);
  return {
    Patients: patients,
    Medications: medications,
    Issues: issues,
    Recommendations: recommendations,
    'Average Medications / Patient': medications,
    'Average Issues / Patient': issues,
    'Average Recommendations / Patient': recommendations,
    'Waiting Lab': waitingLab,
    'No Need For Chronic': noNeedForChronic,
    'No Need %': noNeedForChronic,
  };
}

async function loadChronicPageData(filters: ChronicOverviewFilters): Promise<ChronicPageData> {
  const recommendationFilter = cleanChronicFilter(filters.recommendation);
  const f = {
    period: cleanChronicFilter(filters.period),
    consultant: cleanChronicFilter(filters.consultant),
    recommendation: recommendationFilter ? canonicalizeRecommendation(recommendationFilter) : null,
    issue: cleanChronicFilter(filters.issue),
    medication: cleanChronicFilter(filters.medication),
    patient: cleanChronicFilter(filters.patient),
  };
  const recommendationFilterKey = f.recommendation ? normalizeRecommendationKey(f.recommendation) : null;
  const normalized = {
    period: f.period ?? '',
    consultant: f.consultant ?? '',
    recommendation: f.recommendation ?? '',
    issue: f.issue ?? '',
    medication: f.medication ?? '',
    patient: f.patient ?? '',
  };
  const empty = (): ChronicPageData => {
    const data = emptyChronicData(normalized);
    return { filters: data.filters, options: data.options, currentPeriod: data.currentPeriod, prePost: data.prePost, drilldowns: {} };
  };
  if (!hasDb) return empty();

  try {
    // Stage 1 (only when an issue filter is active): resolve the selected
    // canonical issue to the raw spellings stored in the data, so the SQL
    // aggregates can filter exactly like the JS canonical comparison did.
    let issueVariants: string[] | null = null;
    if (f.issue) {
      const target = canonicalizeIssue(f.issue);
      const raws = await dbQuery<{ raw_value: string }>(`
        ${CHRONIC_PAGE_CTE}
        select distinct btrim(e.value) as raw_value
        from chronic c
        join lateral jsonb_each_text(c.row_data) e(key, value)
          on ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
        where ($1::text is null or c.consultant = $1)
          and ($2::text is null or regexp_replace(lower(btrim(c.recommendation)), '[^a-z0-9]+', '', 'g') = $2)
          and ($3::text is null or c.patient_id ilike '%' || $3 || '%')
      `, [f.consultant, recommendationFilterKey, f.patient]);
      issueVariants = raws.map((row) => row.raw_value).filter((raw) => canonicalizeIssue(raw) === target);
      if (!issueVariants.length) issueVariants = ['__healpath_no_issue_match__'];
    }
    const params = [f.consultant, recommendationFilterKey, f.patient, issueVariants];

    // Stage 2: every dataset in parallel — aggregates only, no row_data shipped.
    const [kpiRows, trendRows, dimRows, issueRows, recommendationRows, operationalRows, drillRows] = await Promise.all([
      dbQuery<ChronicPhaseAggregateRow>(`
        ${CHRONIC_PAGE_CTE}
        select c.phase,
          count(distinct c.patient_id)::int as patients,
          count(*)::int as medications,
          count(*) filter (where c.recommendation is not null and c.recommendation <> '')::int as recommendations,
          coalesce(sum(iss.n), 0)::int as issues
        from chronic c
        left join lateral (
          select count(*)::int as n
          from jsonb_each_text(c.row_data) e(key, value)
          where ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
        ) iss on true
        where ${CHRONIC_PAGE_WHERE}
        group by c.phase
      `, params),
      dbQuery<ChronicPhaseTrendRow>(`
        ${CHRONIC_PAGE_CTE}
        select c.phase, cal.period, min(cal.month_order)::int as month_order,
          count(distinct c.patient_id)::int as patients,
          count(*)::int as medications,
          count(*) filter (where c.recommendation is not null and c.recommendation <> '')::int as recommendations,
          coalesce(sum(iss.n), 0)::int as issues
        from chronic c
        ${CHRONIC_CALENDAR_JOIN}
        left join lateral (
          select count(*)::int as n
          from jsonb_each_text(c.row_data) e(key, value)
          where ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
        ) iss on true
        where ${CHRONIC_PAGE_WHERE}
          and cal.period is not null
        group by c.phase, cal.period
      `, params),
      dbQuery<{ kind: string; value: string }>(`
        ${CHRONIC_PAGE_CTE}
        select kind, value from (
          select distinct 'week'::text as kind, c.week as value from chronic c where ${CHRONIC_PAGE_WHERE}
          union all
          select distinct 'consultant', c.consultant from chronic c where ${CHRONIC_PAGE_WHERE}
          union all
          select distinct 'medication', c.medication_name from chronic c where ${CHRONIC_PAGE_WHERE}
        ) dims
        where value is not null and btrim(value) <> ''
      `, params),
      dbQuery<ChronicLabelCountRow>(`
        ${CHRONIC_PAGE_CTE}
        select c.phase, cal.period, btrim(e.value) as raw_value, count(*)::int as n
        from chronic c
        join lateral jsonb_each_text(c.row_data) e(key, value)
          on ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
        ${CHRONIC_CALENDAR_JOIN}
        where ${CHRONIC_PAGE_WHERE}
        group by c.phase, cal.period, btrim(e.value)
      `, params),
      dbQuery<ChronicLabelCountRow>(`
        ${CHRONIC_PAGE_CTE}
        select c.phase, cal.period, c.recommendation as raw_value, count(*)::int as n
        from chronic c
        ${CHRONIC_CALENDAR_JOIN}
        where ${CHRONIC_PAGE_WHERE}
          and c.recommendation is not null and c.recommendation <> ''
        group by c.phase, cal.period, c.recommendation
      `, params),
      dbQuery<ChronicOperationalRow>(`
        ${CHRONIC_PAGE_CTE}
        select period, count(*)::int as total,
          count(*) filter (where haystack like '%waiting%' or haystack like '%lab result%')::int as waiting,
          count(*) filter (where haystack like '%no need for chronic%')::int as no_need
        from (
          select cal.period,
            lower(coalesce(iss.joined, '') || ' ' || coalesce(c.recommendation, '')) as haystack
          from chronic c
          ${CHRONIC_CALENDAR_JOIN}
          left join lateral (
            select string_agg(btrim(e.value), ' ' order by (regexp_match(regexp_replace(lower(btrim(e.key)), '[^a-z0-9]', '', 'g'), '^issue([0-9]+)'))[1]::int, e.key) as joined
            from jsonb_each_text(c.row_data) e(key, value)
            where ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
          ) iss on true
          where c.phase = 'post' and ${CHRONIC_PAGE_WHERE}
        ) post_rows
        group by period
      `, params),
      dbQuery<ChronicDrillAggregateRow>(`
        ${CHRONIC_PAGE_CTE},
        post_rows as (
          select c.phase, c.week, c.patient_id, c.recommendation, c.medication_name, c.consultant, cal.period,
            coalesce(iss.n, 0)::int as issue_count,
            lower(coalesce(iss.joined, '') || ' ' || coalesce(c.recommendation, '')) as haystack
          from chronic c
          ${CHRONIC_CALENDAR_JOIN}
          left join lateral (
            select count(*)::int as n,
              string_agg(btrim(e.value), ' ' order by (regexp_match(regexp_replace(lower(btrim(e.key)), '[^a-z0-9]', '', 'g'), '^issue([0-9]+)'))[1]::int, e.key) as joined
            from jsonb_each_text(c.row_data) e(key, value)
            where ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
          ) iss on true
          where c.phase = 'post' and ${CHRONIC_PAGE_WHERE}
        ),
        issue_flat as (
          select c.week, c.patient_id, c.medication_name, c.consultant, cal.period, btrim(e.value) as category
          from chronic c
          ${CHRONIC_CALENDAR_JOIN}
          join lateral jsonb_each_text(c.row_data) e(key, value)
            on ${CHRONIC_ISSUE_KEY} and ${CHRONIC_ISSUE_VALUE}
          where c.phase = 'post' and ${CHRONIC_PAGE_WHERE}
        ),
        operational as (
          select *,
            (haystack like '%waiting%' or haystack like '%lab result%') as is_waiting,
            (haystack like '%no need for chronic%') as is_no_need
          from post_rows
        )
        select metric, dimension, period, label, value::int
        from (
          select 'patients'::text as metric, 'weeks'::text as dimension, period, coalesce(period || ' / ' || week, week) as label, count(distinct patient_id) as value from post_rows group by period, week
          union all select 'patients', 'consultants', period, consultant, count(distinct patient_id) from post_rows group by period, consultant
          union all select 'patients', 'patients', period, patient_id, count(*) from post_rows group by period, patient_id
          union all select 'patients', 'medications', period, medication_name, count(distinct patient_id) from post_rows group by period, medication_name

          union all select 'medications', 'weeks', period, coalesce(period || ' / ' || week, week), count(*) from post_rows group by period, week
          union all select 'medications', 'consultants', period, consultant, count(*) from post_rows group by period, consultant
          union all select 'medications', 'patients', period, patient_id, count(*) from post_rows group by period, patient_id
          union all select 'medications', 'medications', period, medication_name, count(*) from post_rows group by period, medication_name

          union all select 'issues', 'weeks', period, coalesce(period || ' / ' || week, week), count(*) from issue_flat group by period, week
          union all select 'issues', 'consultants', period, consultant, count(*) from issue_flat group by period, consultant
          union all select 'issues', 'patients', period, patient_id, count(*) from issue_flat group by period, patient_id
          union all select 'issues', 'medications', period, medication_name, count(*) from issue_flat group by period, medication_name
          union all select 'issues', 'categories', period, category, count(*) from issue_flat group by period, category

          union all select 'recommendations', 'weeks', period, coalesce(period || ' / ' || week, week), count(*) from post_rows where recommendation is not null and recommendation <> '' group by period, week
          union all select 'recommendations', 'consultants', period, consultant, count(*) from post_rows where recommendation is not null and recommendation <> '' group by period, consultant
          union all select 'recommendations', 'patients', period, patient_id, count(*) from post_rows where recommendation is not null and recommendation <> '' group by period, patient_id
          union all select 'recommendations', 'medications', period, medication_name, count(*) from post_rows where recommendation is not null and recommendation <> '' group by period, medication_name
          union all select 'recommendations', 'categories', period, recommendation, count(*) from post_rows where recommendation is not null and recommendation <> '' group by period, recommendation

          union all select 'waitingLab', 'weeks', period, coalesce(period || ' / ' || week, week), count(*) from operational where is_waiting group by period, week
          union all select 'waitingLab', 'consultants', period, consultant, count(*) from operational where is_waiting group by period, consultant
          union all select 'waitingLab', 'patients', period, patient_id, count(*) from operational where is_waiting group by period, patient_id
          union all select 'waitingLab', 'medications', period, medication_name, count(*) from operational where is_waiting group by period, medication_name

          union all select 'noNeedForChronic', 'weeks', period, coalesce(period || ' / ' || week, week), count(*) from operational where is_no_need group by period, week
          union all select 'noNeedForChronic', 'consultants', period, consultant, count(*) from operational where is_no_need group by period, consultant
          union all select 'noNeedForChronic', 'patients', period, patient_id, count(*) from operational where is_no_need group by period, patient_id
          union all select 'noNeedForChronic', 'medications', period, medication_name, count(*) from operational where is_no_need group by period, medication_name
        ) ranked
        where label is not null and btrim(label) <> ''
      `, params),
    ]);

    // ── Options (same uniq/trim/sort semantics as getChronicOverview) ──
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    const presentWeeks = uniq(dimRows.filter((row) => row.kind === 'week').map((row) => row.value));
    const calendar = await getChronicCalendar();
    const options: ChronicOverviewData['options'] = {
      periods: chronicPeriodsForWeeks(calendar, presentWeeks).map((entry) => entry.period),
      weeks: presentWeeks,
      consultants: chronicConsultantOptions(dimRows.filter((row) => row.kind === 'consultant').map((row) => row.value)),
      recommendations: uniq(recommendationRows.map((row) => canonicalizeRecommendation(row.raw_value))),
      issues: uniq(issueRows.map((row) => canonicalizeIssue(row.raw_value))),
      medications: uniq(dimRows.filter((row) => row.kind === 'medication').map((row) => row.value)),
    };
    if (!kpiRows.length && !trendRows.length) return { ...empty(), options };

    // ── Period scope (identical semantics: All = every scoped row,
    //    an explicit valid Period selection narrows the scope) ──
    const periods = Array.from(new Set(trendRows.map((row) => row.period as string).filter(Boolean)))
      .sort((a, b) =>
        (trendRows.find((row) => row.period === a)?.month_order ?? 0) -
        (trendRows.find((row) => row.period === b)?.month_order ?? 0));
    if (!periods.length) return { ...empty(), options };
    const selectedPeriod = f.period && periods.includes(f.period) ? f.period : null;

    const scopeRows = (phase: 'pre' | 'post') => selectedPeriod
      ? trendRows.filter((row) => row.phase === phase && row.period === selectedPeriod)
      : kpiRows.filter((row) => row.phase === phase);
    const pre = chronicPhaseTotals(scopeRows('pre'));
    const post = chronicPhaseTotals(scopeRows('post'));
    const metrics = [
      comparisonMetric('Patients', pre.patients, post.patients),
      comparisonMetric('Medications', pre.medications, post.medications),
      comparisonMetric('Issues', pre.issues, post.issues),
      comparisonMetric('Recommendations', pre.recommendations, post.recommendations),
      comparisonMetric('Average Medications / Patient', pre.avgMedications, post.avgMedications, 2),
      comparisonMetric('Average Issues / Patient', pre.avgIssues, post.avgIssues, 2),
      comparisonMetric('Average Recommendations / Patient', pre.avgRecommendations, post.avgRecommendations, 2),
    ];

    const outcomeTrends: ChronicOutcomeTrendPoint[] = periods.map((period) => {
      const perPhase = (phase: 'pre' | 'post') =>
        chronicPhaseTotals(trendRows.filter((row) => row.phase === phase && row.period === period));
      const periodPre = perPhase('pre');
      const periodPost = perPhase('post');
      return {
        period,
        preIssuesPerPatient: periodPre.avgIssues,
        postIssuesPerPatient: periodPost.avgIssues,
        issueImprovementPct: improvementPct(periodPre.avgIssues, periodPost.avgIssues),
        preRecommendationsPerPatient: periodPre.avgRecommendations,
        postRecommendationsPerPatient: periodPost.avgRecommendations,
        recommendationImprovementPct: improvementPct(periodPre.avgRecommendations, periodPost.avgRecommendations),
      };
    });

    const issueCounts = chronicScopedLabelCounts(issueRows, selectedPeriod, 'issue');
    const recommendationCounts = chronicScopedLabelCounts(recommendationRows, selectedPeriod, 'recommendation');
    const issueCatalog = chronicCatalogFromCounts(CHRONIC_CANONICAL_ISSUES, issueCounts);
    const recommendationCatalog = chronicCatalogFromCounts(CHRONIC_RECOMMENDATION_CATALOG, recommendationCounts);

    const operationalScope = operationalRows.filter((row) => (selectedPeriod ? row.period === selectedPeriod : true));
    const operationalTotals = operationalScope.reduce(
      (sum, row) => ({ total: sum.total + row.total, waiting: sum.waiting + row.waiting, noNeed: sum.noNeed + row.no_need }),
      { total: 0, waiting: 0, noNeed: 0 },
    );
    const operational: ChronicOperationalKpis = {
      waitingLab: operationalTotals.waiting,
      noNeedForChronic: operationalTotals.noNeed,
      noNeedPct: operationalTotals.total ? Number(((operationalTotals.noNeed / operationalTotals.total) * 100).toFixed(2)) : 0,
    };
    const drilldowns = buildChronicKpiDrilldowns(drillRows, selectedPeriod);

    return {
      filters: normalized,
      options,
      currentPeriod: selectedPeriod,
      prePost: { metrics, outcomeTrends, issueCatalog, recommendationCatalog, operational },
      drilldowns,
    };
  } catch (e) {
    console.warn('loadChronicPageData live query failed:', (e as Error).message);
    return empty();
  }
}

// Per-request memo so every Suspense section shares one set of in-flight
// queries (kicked off once, awaited independently — no duplicated SQL).
const chronicPageDataCache = new Map<string, Promise<ChronicPageData>>();

export function getChronicPageData(filters: ChronicOverviewFilters): Promise<ChronicPageData> {
  const key = JSON.stringify([
    cleanChronicFilter(filters.period),
    cleanChronicFilter(filters.consultant),
    canonicalizeRecommendation(cleanChronicFilter(filters.recommendation)),
    cleanChronicFilter(filters.issue),
    cleanChronicFilter(filters.patient),
  ]);
  const cached = chronicPageDataCache.get(key);
  if (cached) return cached;
  const promise = loadChronicPageData(filters).finally(() => {
    // Short-lived memo: keep the result briefly so parallel Suspense sections
    // (and quick refreshes) reuse it, then release so new imports show up.
    setTimeout(() => chronicPageDataCache.delete(key), 15_000).unref?.();
  });
  chronicPageDataCache.set(key, promise);
  return promise;
}

export interface ChronicPatientExplorerFilters {
  patient?: string | null;
}

export interface ChronicPatientTimelineRow {
  phase: 'pre' | 'post';
  week: string;
  period: string;
  medicationName: string;
  recommendation: string;
  issues: string[];
}

export interface ChronicPatientSummary {
  patientId: string;
  weeks: number;
  preMedications: number;
  postMedications: number;
  medicationDifference: number;
  preIssues: number;
  postIssues: number;
  issueDifference: number;
  preRecommendations: number;
  postRecommendations: number;
  recommendationDifference: number;
}

export interface ChronicPatientChange {
  label: string;
  pre: number;
  post: number;
  difference: number;
  status: 'Added' | 'Removed' | 'Changed' | 'Unchanged';
}

export interface ChronicPatientHistoryItem {
  label: string;
  pre: number;
  post: number;
  total: number;
  weeks: string[];
}

export interface ChronicPatientWeekHistory {
  week: string;
  period: string;
  preMedications: number;
  postMedications: number;
  preIssues: number;
  postIssues: number;
  preRecommendations: number;
  postRecommendations: number;
}

export interface ChronicPatientExplorerData {
  filters: Required<ChronicPatientExplorerFilters>;
  matches: string[];
  selectedPatientId: string | null;
  summary: ChronicPatientSummary | null;
  timeline: ChronicPatientTimelineRow[];
  medicationChanges: ChronicPatientChange[];
  issueHistory: ChronicPatientHistoryItem[];
  recommendationHistory: ChronicPatientHistoryItem[];
  weekHistory: ChronicPatientWeekHistory[];
}

interface ChronicPatientDbRow {
  phase: 'pre' | 'post';
  week: string;
  period: string | null;
  month_order: number | null;
  patient_id: string;
  recommendation: string | null;
  medication_name: string | null;
  issue_values: string[] | null;
}

function chronicPatientEmpty(patient: string): ChronicPatientExplorerData {
  return {
    filters: { patient },
    matches: [],
    selectedPatientId: null,
    summary: null,
    timeline: [],
    medicationChanges: [],
    issueHistory: [],
    recommendationHistory: [],
    weekHistory: [],
  };
}

function countByLabel(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const cleaned = label.trim();
    if (!cleaned) continue;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return counts;
}

function chronicPatientChanges(pre: Map<string, number>, post: Map<string, number>): ChronicPatientChange[] {
  const labels = new Set([...pre.keys(), ...post.keys()]);
  return Array.from(labels)
    .map((label) => {
      const before = pre.get(label) ?? 0;
      const after = post.get(label) ?? 0;
      const status: ChronicPatientChange['status'] = before === 0 && after > 0
        ? 'Added'
        : before > 0 && after === 0
          ? 'Removed'
          : before !== after
            ? 'Changed'
            : 'Unchanged';
      return { label, pre: before, post: after, difference: after - before, status };
    })
    .sort((a, b) => {
      const priority = { Added: 0, Removed: 1, Changed: 2, Unchanged: 3 } as const;
      return priority[a.status] - priority[b.status] || Math.abs(b.difference) - Math.abs(a.difference) || a.label.localeCompare(b.label);
    });
}

function chronicPatientHistory(rows: ChronicPatientTimelineRow[], labelsForRow: (row: ChronicPatientTimelineRow) => string[]) {
  const map = new Map<string, { pre: number; post: number; weeks: Set<string> }>();
  for (const row of rows) {
    for (const label of labelsForRow(row)) {
      const cleaned = label.trim();
      if (!cleaned) continue;
      const current = map.get(cleaned) ?? { pre: 0, post: 0, weeks: new Set<string>() };
      current[row.phase] += 1;
      current.weeks.add(row.week);
      map.set(cleaned, current);
    }
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({
      label,
      pre: value.pre,
      post: value.post,
      total: value.pre + value.post,
      weeks: Array.from(value.weeks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export async function getChronicPatientExplorer(filters: ChronicPatientExplorerFilters): Promise<ChronicPatientExplorerData> {
  const patient = cleanChronicFilter(filters.patient) ?? '';
  if (!patient || !hasDb) return chronicPatientEmpty(patient);

  try {
    const matches = await dbQuery<{ patient_id: string }>(`
      with chronic as (
        select btrim(patient_id) as patient_id from healpath.chronic_pre
        union
        select btrim(patient_id) as patient_id from healpath.chronic_post
      )
      select patient_id
      from chronic
      where patient_id ilike '%' || $1 || '%'
      order by
        case when lower(patient_id) = lower($1) then 0 else 1 end,
        patient_id
      limit 20
    `, [patient]);
    const patientMatches = matches.map((row) => row.patient_id);
    const selectedPatientId = patientMatches.find((value) => value.toLowerCase() === patient.toLowerCase())
      ?? (patientMatches.length === 1 ? patientMatches[0] : null);
    if (!selectedPatientId) {
      return { ...chronicPatientEmpty(patient), matches: patientMatches };
    }

    const rows = await dbQuery<ChronicPatientDbRow>(`
      with chronic as (
        select 'pre'::text as phase, week, btrim(patient_id) as patient_id, recommendation, medication_name, row_data
        from healpath.chronic_pre
        where btrim(patient_id) = $1
        union all
        select 'post'::text as phase, week, btrim(patient_id) as patient_id, recommendation, medication_name, row_data
        from healpath.chronic_post
        where btrim(patient_id) = $1
      )
      select c.phase, c.week, cal.period, cal.month_order, c.patient_id, c.recommendation, c.medication_name,
        coalesce(issue_extract.issue_values, array[]::text[]) as issue_values
      from chronic c
      left join healpath.chronic_calendar cal on cal.week = nullif((regexp_match(c.week, '[0-9]+'))[1], '')::int
      left join lateral (
        select array_agg(issue_value order by issue_number, issue_key) as issue_values
        from (
          select
            issue_entry.key as issue_key,
            (regexp_match(regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g'), '^issue([0-9]+)'))[1]::int as issue_number,
            btrim(issue_entry.value) as issue_value
          from jsonb_each_text(c.row_data::jsonb) as issue_entry(key, value)
          where regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g') ~ '^issue[0-9]+'
            and btrim(issue_entry.value) <> ''
            and regexp_replace(lower(btrim(issue_entry.value)), '[^a-z0-9]', '', 'g') !~ '^issue[0-9]+$'
        ) issue_columns
      ) issue_extract on true
      order by cal.month_order nulls last, c.week, c.phase, c.medication_name
    `, [selectedPatientId]);

    const timeline: ChronicPatientTimelineRow[] = rows.map((row) => ({
      phase: row.phase,
      week: row.week,
      period: row.period ?? 'Unmapped',
      medicationName: row.medication_name?.trim() || 'Unspecified medication',
      recommendation: canonicalizeRecommendation(row.recommendation),
      issues: (row.issue_values ?? []).map((value) => canonicalizeIssue(value)).filter(Boolean),
    }));
    const preRows = timeline.filter((row) => row.phase === 'pre');
    const postRows = timeline.filter((row) => row.phase === 'post');
    const preIssues = preRows.reduce((sum, row) => sum + row.issues.length, 0);
    const postIssues = postRows.reduce((sum, row) => sum + row.issues.length, 0);
    const preRecommendations = preRows.filter((row) => row.recommendation).length;
    const postRecommendations = postRows.filter((row) => row.recommendation).length;
    const weeks = new Set(timeline.map((row) => row.week));
    const summary: ChronicPatientSummary = {
      patientId: selectedPatientId,
      weeks: weeks.size,
      preMedications: preRows.length,
      postMedications: postRows.length,
      medicationDifference: postRows.length - preRows.length,
      preIssues,
      postIssues,
      issueDifference: postIssues - preIssues,
      preRecommendations,
      postRecommendations,
      recommendationDifference: postRecommendations - preRecommendations,
    };

    const medicationChanges = chronicPatientChanges(
      countByLabel(preRows.map((row) => row.medicationName)),
      countByLabel(postRows.map((row) => row.medicationName)),
    );
    const issueHistory = chronicPatientHistory(timeline, (row) => row.issues);
    const recommendationHistory = chronicPatientHistory(timeline, (row) => row.recommendation ? [row.recommendation] : []);
    const weekMap = new Map<string, ChronicPatientWeekHistory>();
    for (const row of timeline) {
      const key = `${row.period}\u0000${row.week}`;
      const current = weekMap.get(key) ?? {
        week: row.week,
        period: row.period,
        preMedications: 0,
        postMedications: 0,
        preIssues: 0,
        postIssues: 0,
        preRecommendations: 0,
        postRecommendations: 0,
      };
      if (row.phase === 'pre') {
        current.preMedications += 1;
        current.preIssues += row.issues.length;
        if (row.recommendation) current.preRecommendations += 1;
      } else {
        current.postMedications += 1;
        current.postIssues += row.issues.length;
        if (row.recommendation) current.postRecommendations += 1;
      }
      weekMap.set(key, current);
    }
    const weekHistory = Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week, undefined, { numeric: true }));

    return {
      filters: { patient },
      matches: patientMatches,
      selectedPatientId,
      summary,
      timeline,
      medicationChanges,
      issueHistory,
      recommendationHistory,
      weekHistory,
    };
  } catch (e) {
    console.warn('getChronicPatientExplorer live query failed:', (e as Error).message);
    return chronicPatientEmpty(patient);
  }
}

export interface Patient360Filters {
  patient?: string | null;
}

export interface Patient360Summary {
  patientId: string;
  firstAcuteVisit: string | null;
  latestAcuteVisit: string | null;
  acuteVisits: number;
  chronicReviews: number;
  doctorsSeen: number;
  diagnoses: number;
  medications: number;
  labs: number;
  scans: number;
}

export interface Patient360Diagnosis {
  disease: string;
  icdDesc: string;
  icdBlock: string;
}

export interface Patient360Medication {
  medication: string;
  brand: string;
  activeIngredient: string;
}

export interface Patient360DiagnosticItem {
  test: string;
}

export interface Patient360AcuteVisit {
  visitId: string;
  visitDate: string;
  doctor: string;
  specialty: string;
  diagnosisCount: number;
  medicationCount: number;
  labsCount: number;
  scansCount: number;
  diagnoses: Patient360Diagnosis[];
  medications: Patient360Medication[];
  labs: Patient360DiagnosticItem[];
  scans: Patient360DiagnosticItem[];
}

export interface Patient360ChronicReview {
  id: string;
  week: string;
  period: string;
  phase: 'pre' | 'post';
  recommendationCount: number;
  issueCount: number;
  recommendations: string[];
  issues: string[];
  sortKey: string;
}

/** One acute prescription row (drug_fact) — NOT aggregated. */
export interface Patient360AcuteMedicationRow {
  id: string;
  visitDate: string | null;
  medication: string;
  activeIngredient: string;
  brand: string;
}

/** One chronic review medication row (Pre/Post) — exactly as stored. */
export interface Patient360ChronicMedicationRow {
  id: string;
  week: string;
  period: string;
  phase: 'pre' | 'post';
  medication: string;
  recommendation: string;
}

/**
 * Medication history merges BOTH sources: acute prescriptions (drug_fact,
 * newest visit first) and chronic review rows (Pre/Post, newest week first —
 * every row as stored, no aggregation, no deduplication).
 */
export interface Patient360MedicationHistory {
  acute: Patient360AcuteMedicationRow[];
  chronic: Patient360ChronicMedicationRow[];
}

export interface Patient360IssueCatalogRow {
  issue: string;
  pre: number;
  post: number;
  difference: number;
  improvementPct: number;
}

export type Patient360TimelineEvent =
  | {
      id: string;
      type: 'acute';
      sortKey: string;
      date: string;
      doctor: string;
      diagnosisCount: number;
      medicationCount: number;
    }
  | {
      id: string;
      type: 'chronic';
      sortKey: string;
      week: string;
      period: string;
      phase: 'pre' | 'post';
      recommendationCount: number;
      issueCount: number;
    };

export interface Patient360Data {
  filters: Required<Patient360Filters>;
  found: boolean;
  summary: Patient360Summary | null;
  timeline: Patient360TimelineEvent[];
  acuteVisits: Patient360AcuteVisit[];
  chronicReviews: Patient360ChronicReview[];
  medicationHistory: Patient360MedicationHistory;
  issueCatalog: Patient360IssueCatalogRow[];
}

function patient360Empty(patient: string): Patient360Data {
  return {
    filters: { patient },
    found: false,
    summary: null,
    timeline: [],
    acuteVisits: [],
    chronicReviews: [],
    medicationHistory: { acute: [], chronic: [] },
    issueCatalog: [],
  };
}

function patient360IssueCatalog(rawCounts: Array<{ issue: string; phase: 'pre' | 'post'; value: number }> | null): Patient360IssueCatalogRow[] {
  const counts = new Map<string, { pre: number; post: number }>();
  for (const issue of CHRONIC_CANONICAL_ISSUES) counts.set(issue, { pre: 0, post: 0 });
  for (const row of rawCounts ?? []) {
    const label = canonicalizeIssue(row.issue);
    if (!counts.has(label)) counts.set(label, { pre: 0, post: 0 });
    const current = counts.get(label)!;
    current[row.phase] += Number(row.value);
  }
  return Array.from(counts.entries()).map(([issue, value]) => ({
    issue,
    pre: value.pre,
    post: value.post,
    difference: value.post - value.pre,
    improvementPct: improvementPct(value.pre, value.post),
  }));
}

function patient360ChronicSortKey(period: string, week: string, phase: 'pre' | 'post'): string {
  const monthNumbers: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const [monthName, year] = period.split(/\s+/);
  const month = monthNumbers[monthName];
  const weekNumber = Number((week.match(/[0-9]+/) ?? [''])[0]);
  if (!month || !year || !weekNumber) return `9999-12-31-${phase}-${week}`;
  const day = String(1 + ((weekNumber - 1) % 4) * 7).padStart(2, '0');
  return `${year}-${month}-${day}-${phase === 'pre' ? '0-pre' : '1-post'}`;
}

export async function getPatient360(filters: Patient360Filters): Promise<Patient360Data> {
  const patient = cleanChronicFilter(filters.patient) ?? '';
  if (!patient || !hasDb) return patient360Empty(patient);
  const patientNumber = /^\d+$/.test(patient) ? Number(patient) : null;

  try {
    const patient360SourceRows = await dbQuery<{
      has_acute: boolean;
      has_chronic_pre: boolean;
      has_chronic_post: boolean;
    }>(`
        select
          exists(
            select 1
            from healpath.visits v
            where $2::int is not null and v.patient_id = $2
          ) as has_acute,
          exists(
            select 1
            from healpath.chronic_pre cp
            where cp.patient_id = $1 or btrim(cp.patient_id) = $1
          ) as has_chronic_pre,
          exists(
            select 1
            from healpath.chronic_post cpo
            where cpo.patient_id = $1 or btrim(cpo.patient_id) = $1
          ) as has_chronic_post
      `, [patient, patientNumber]);
    const patient360Sources = patient360SourceRows[0] ?? {
      has_acute: false,
      has_chronic_pre: false,
      has_chronic_post: false,
    };
    const patient360HasAcute = patient360Sources.has_acute;
    const patient360HasChronic = patient360Sources.has_chronic_pre || patient360Sources.has_chronic_post;
    if (!patient360HasAcute && !patient360HasChronic) return patient360Empty(patient);

    const patient360AcuteRows = patient360HasAcute ? await dbQuery<Patient360AcuteVisit>(`
        with acute_base as (
          select
            v.visit_id,
            to_char(v.prescription_date, 'YYYY-MM-DD') as visit_date,
            coalesce(nullif(btrim(v.practitioner_name), ''), 'Unassigned') as doctor,
            coalesce(nullif(btrim(v.doctor_specialty), ''), 'Unassigned') as specialty
          from healpath.visits v
          where $1::int is not null and v.patient_id = $1
        ),
        diagnosis_by_visit as (
          select d.visit_id, count(*)::int as diagnosis_count,
            jsonb_agg(jsonb_build_object(
              'disease', coalesce(nullif(btrim(d.diseases), ''), 'Unspecified diagnosis'),
              'icdDesc', coalesce(nullif(btrim(d.icd_desc), ''), 'Unspecified ICD description'),
              'icdBlock', coalesce(nullif(btrim(d.icd_block), ''), 'Unspecified ICD block')
            ) order by d.icd_block, d.icd_desc) as diagnoses
          from healpath.diagnosis_fact d
          join acute_base a on a.visit_id = d.visit_id
          group by d.visit_id
        ),
        drug_by_visit as (
          select d.visit_id, count(*)::int as medication_count,
            jsonb_agg(jsonb_build_object(
              'medication', coalesce(nullif(btrim(d.medications), ''), nullif(btrim(d.brand), ''), 'Unspecified medication'),
              'brand', coalesce(nullif(btrim(d.brand), ''), 'Unspecified brand'),
              'activeIngredient', coalesce(nullif(btrim(d.ac), ''), 'Unspecified active ingredient')
            ) order by d.brand, d.ac) as medications
          from healpath.drug_fact d
          join acute_base a on a.visit_id = d.visit_id
          group by d.visit_id
        ),
        lab_by_visit as (
          select l.visit_id, count(*)::int as labs_count,
            jsonb_agg(jsonb_build_object('test', coalesce(nullif(btrim(l.tests), ''), 'Unspecified lab')) order by l.tests) as labs
          from healpath.lab_fact l
          join acute_base a on a.visit_id = l.visit_id
          group by l.visit_id
        ),
        scan_by_visit as (
          select s.visit_id, count(*)::int as scans_count,
            jsonb_agg(jsonb_build_object('test', coalesce(nullif(btrim(s.tests), ''), 'Unspecified scan')) order by s.tests) as scans
          from healpath.scan_fact s
          join acute_base a on a.visit_id = s.visit_id
          group by s.visit_id
        )
        select
          a.visit_id as "visitId",
          a.visit_date as "visitDate",
          a.doctor,
          a.specialty,
          coalesce(d.diagnosis_count, 0) as "diagnosisCount",
          coalesce(rx.medication_count, 0) as "medicationCount",
          coalesce(l.labs_count, 0) as "labsCount",
          coalesce(s.scans_count, 0) as "scansCount",
          coalesce(d.diagnoses, '[]'::jsonb) as diagnoses,
          coalesce(rx.medications, '[]'::jsonb) as medications,
          coalesce(l.labs, '[]'::jsonb) as labs,
          coalesce(s.scans, '[]'::jsonb) as scans
        from acute_base a
        left join diagnosis_by_visit d on d.visit_id = a.visit_id
        left join drug_by_visit rx on rx.visit_id = a.visit_id
        left join lab_by_visit l on l.visit_id = a.visit_id
        left join scan_by_visit s on s.visit_id = a.visit_id
        order by a.visit_date, a.visit_id
      `, [patientNumber]) : [];
    const patient360ChronicRows = patient360HasChronic ? await dbQuery<Omit<Patient360ChronicReview, 'issues'> & { issues: string[] | null }>(`
        with chronic_base as (
          select 'pre'::text as phase, cp.week, cp.period, cp.month_order, cp.recommendation, cp.row_data
          from healpath.chronic_pre cp
          where cp.patient_id = $1 or btrim(cp.patient_id) = $1
          union all
          select 'post'::text as phase, cpo.week, cpo.period, cpo.month_order, cpo.recommendation, cpo.row_data
          from healpath.chronic_post cpo
          where cpo.patient_id = $1 or btrim(cpo.patient_id) = $1
        ),
        chronic_with_issues as (
          select c.*, coalesce(issue_extract.issue_values, array[]::text[]) as issue_values
          from chronic_base c
          left join lateral (
            select array_agg(issue_value order by issue_number, issue_key) as issue_values
            from (
              select
                issue_entry.key as issue_key,
                (regexp_match(regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g'), '^issue([0-9]+)'))[1]::int as issue_number,
                btrim(issue_entry.value) as issue_value
              from jsonb_each_text(c.row_data::jsonb) as issue_entry(key, value)
              where regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g') ~ '^issue[0-9]+'
                and btrim(issue_entry.value) <> ''
                and regexp_replace(lower(btrim(issue_entry.value)), '[^a-z0-9]', '', 'g') !~ '^issue[0-9]+$'
            ) issue_columns
          ) issue_extract on true
        ),
        chronic_issue_flat as (
          select c.phase, c.week, c.period, btrim(issue_value) as issue
          from chronic_with_issues c
          cross join unnest(c.issue_values) as issue_value
          where btrim(issue_value) <> ''
        )
        select
          concat(c.phase, '-', coalesce(c.period, 'Unmapped'), '-', c.week) as id,
          c.week,
          coalesce(c.period, 'Unmapped') as period,
          c.phase,
          count(*) filter (where c.recommendation is not null and btrim(c.recommendation) <> '')::int as "recommendationCount",
          sum(cardinality(c.issue_values))::int as "issueCount",
          coalesce(array_agg(distinct btrim(c.recommendation)) filter (where c.recommendation is not null and btrim(c.recommendation) <> ''), array[]::text[]) as recommendations,
          coalesce((select array_agg(distinct i.issue order by i.issue) from chronic_issue_flat i where i.phase = c.phase and i.week = c.week and coalesce(i.period, 'Unmapped') = coalesce(c.period, 'Unmapped')), array[]::text[]) as issues,
          concat(lpad(coalesce(c.month_order, 999)::text, 3, '0'), '-', lpad(coalesce((regexp_match(c.week, '[0-9]+'))[1]::int, 999)::text, 3, '0'), '-', c.phase) as "sortKey"
        from chronic_with_issues c
        group by c.phase, c.week, c.period, c.month_order
        order by "sortKey"
      `, [patient]) : [];
    // Medication history — every acute prescription ROW (no aggregation),
    // newest visit first.
    const patient360AcuteMedicationRows = patient360HasAcute ? await dbQuery<Patient360AcuteMedicationRow>(`
        with acute_base as (
          select v.visit_id, to_char(v.prescription_date, 'YYYY-MM-DD') as visit_date
          from healpath.visits v
          where $1::int is not null and v.patient_id = $1
        )
        select
          concat('acute-', d.id) as id,
          a.visit_date as "visitDate",
          coalesce(nullif(btrim(d.medications), ''), nullif(btrim(d.brand), ''), 'Unspecified medication') as medication,
          coalesce(nullif(btrim(d.ac), ''), '') as "activeIngredient",
          coalesce(nullif(btrim(d.brand), ''), '') as brand
        from healpath.drug_fact d
        join acute_base a on a.visit_id = d.visit_id
        order by a.visit_date desc nulls last, d.id desc
      `, [patientNumber]) : [];
    // Medication history — every chronic review medication ROW exactly as
    // stored (Pre/Post, no aggregation, no deduplication), newest week first.
    const patient360ChronicMedicationRows = patient360HasChronic ? await dbQuery<Patient360ChronicMedicationRow>(`
        with chronic_base as (
          select 'pre'::text as phase, cp.id, cp.week, cp.period, cp.month_order, cp.medication_name, cp.recommendation
          from healpath.chronic_pre cp
          where cp.patient_id = $1 or btrim(cp.patient_id) = $1
          union all
          select 'post'::text as phase, cpo.id, cpo.week, cpo.period, cpo.month_order, cpo.medication_name, cpo.recommendation
          from healpath.chronic_post cpo
          where cpo.patient_id = $1 or btrim(cpo.patient_id) = $1
        )
        select
          concat('chronic-', c.phase, '-', c.id) as id,
          c.week,
          coalesce(c.period, 'Unmapped') as period,
          c.phase,
          coalesce(nullif(btrim(c.medication_name), ''), 'Unspecified medication') as medication,
          coalesce(nullif(btrim(c.recommendation), ''), '-') as recommendation
        from chronic_base c
        order by
          coalesce(c.month_order, 999) desc,
          coalesce((regexp_match(c.week, '[0-9]+'))[1]::int, 999) desc,
          c.phase desc,
          c.id
      `, [patient]) : [];
    const patient360IssueRows = patient360HasChronic ? await dbQuery<{ issue: string; phase: 'pre' | 'post'; value: number }>(`
        with chronic_base as (
          select 'pre'::text as phase, cp.row_data
          from healpath.chronic_pre cp
          where cp.patient_id = $1 or btrim(cp.patient_id) = $1
          union all
          select 'post'::text as phase, cpo.row_data
          from healpath.chronic_post cpo
          where cpo.patient_id = $1 or btrim(cpo.patient_id) = $1
        )
        select c.phase, btrim(issue_entry.value) as issue, count(*)::int as value
        from chronic_base c
        cross join jsonb_each_text(c.row_data::jsonb) as issue_entry(key, value)
        where regexp_replace(lower(btrim(issue_entry.key)), '[^a-z0-9]', '', 'g') ~ '^issue[0-9]+'
          and btrim(issue_entry.value) <> ''
          and regexp_replace(lower(btrim(issue_entry.value)), '[^a-z0-9]', '', 'g') !~ '^issue[0-9]+$'
        group by c.phase, btrim(issue_entry.value)
      `, [patient]) : [];
    const patient360DoctorRows = await dbQuery<{ doctors_seen: number }>(`
        with doctors as (
          select coalesce(nullif(btrim(v.practitioner_name), ''), 'Unassigned') as doctor
          from healpath.visits v
          where $2::int is not null and v.patient_id = $2
          union all
          select ${CHRONIC_CONSULTANT} as doctor
          from healpath.chronic_pre cp
          where cp.patient_id = $1 or btrim(cp.patient_id) = $1
          union all
          select ${CHRONIC_CONSULTANT} as doctor
          from healpath.chronic_post cpo
          where cpo.patient_id = $1 or btrim(cpo.patient_id) = $1
        )
        select count(distinct doctor)::int as doctors_seen
        from doctors
        where doctor is not null and btrim(doctor) <> '' and doctor <> 'Unassigned'
      `, [patient, patientNumber]);

    const patient360AcuteVisits = patient360AcuteRows.map((visit) => ({
      ...visit,
      diagnoses: visit.diagnoses ?? [],
      medications: visit.medications ?? [],
      labs: visit.labs ?? [],
      scans: visit.scans ?? [],
    }));
    const patient360ChronicReviews = patient360ChronicRows.map((review) => ({
      ...review,
      phase: review.phase,
      issues: (review.issues ?? []).map((issue) => canonicalizeIssue(issue)).filter(Boolean),
    }));

    const patient360Timeline: Patient360TimelineEvent[] = [
      ...patient360AcuteVisits.map((visit) => ({
        id: visit.visitId,
        type: 'acute' as const,
        sortKey: `${visit.visitDate}-acute-${visit.visitId}`,
        date: visit.visitDate,
        doctor: visit.doctor,
        diagnosisCount: visit.diagnosisCount,
        medicationCount: visit.medicationCount,
      })),
      ...patient360ChronicReviews.map((review) => ({
        id: review.id,
        type: 'chronic' as const,
        sortKey: patient360ChronicSortKey(review.period, review.week, review.phase),
        week: review.week,
        period: review.period,
        phase: review.phase,
        recommendationCount: review.recommendationCount,
        issueCount: review.issueCount,
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }));

    const patient360AcuteDates = patient360AcuteVisits
      .map((visit) => visit.visitDate)
      .filter((visitDate): visitDate is string => Boolean(visitDate));

    // Medications count BOTH sources: every acute drug_fact row plus every
    // chronic review medication row. A patient with chronic medications can
    // never show Medications = 0.
    const patient360ChronicMedicationCount = patient360ChronicMedicationRows
      .filter((row) => row.medication !== 'Unspecified medication').length;
    const patient360Summary: Patient360Summary = {
      patientId: patient,
      firstAcuteVisit: patient360AcuteDates[0] ?? null,
      latestAcuteVisit: patient360AcuteDates[patient360AcuteDates.length - 1] ?? null,
      acuteVisits: patient360AcuteVisits.length,
      chronicReviews: patient360ChronicReviews.length,
      doctorsSeen: Number(patient360DoctorRows[0]?.doctors_seen ?? 0),
      diagnoses: patient360AcuteVisits.reduce((sum, visit) => sum + visit.diagnosisCount, 0),
      medications: patient360AcuteVisits.reduce((sum, visit) => sum + visit.medicationCount, 0)
        + patient360ChronicMedicationCount,
      labs: patient360AcuteVisits.reduce((sum, visit) => sum + visit.labsCount, 0),
      scans: patient360AcuteVisits.reduce((sum, visit) => sum + visit.scansCount, 0),
    };

    return {
      filters: { patient },
      found: true,
      summary: patient360Summary,
      timeline: patient360Timeline,
      acuteVisits: patient360AcuteVisits,
      chronicReviews: patient360ChronicReviews,
      medicationHistory: { acute: patient360AcuteMedicationRows, chronic: patient360ChronicMedicationRows },
      issueCatalog: patient360IssueCatalog(patient360IssueRows),
    };

  } catch (e) {
    console.warn('getPatient360 live query failed:', (e as Error).message);
    return patient360Empty(patient);
  }
}
