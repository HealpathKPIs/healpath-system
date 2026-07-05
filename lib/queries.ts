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
      const rows = await dbQuery<Record<string, unknown>>(`
        with base as (
          select v.visit_id, v.patient_id from healpath.visits v where ${VISIT_FILTER}
        )
        select
          (select count(distinct visit_id) from base) as visits,
          (select count(distinct patient_id) from base) as patients,
          (select count(distinct v.practitioner_name) from healpath.visits v where ${VISIT_FILTER}) as doctors,
          (select count(distinct v.doctor_specialty) from healpath.visits v where ${VISIT_FILTER}) as specialties,
          (select count(d.brand)::numeric from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id where ${VISIT_FILTER})
            / nullif((select count(distinct visit_id) from base), 0) as avg_meds,
          (select count(l.tests)::numeric from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id where ${VISIT_FILTER})
            / nullif((select count(distinct visit_id) from base), 0) as avg_labs,
          (select count(s.tests)::numeric from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id where ${VISIT_FILTER})
            / nullif((select count(distinct visit_id) from base), 0) as avg_scans
      `, visitParams(f));
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
