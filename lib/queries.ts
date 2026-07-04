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
// Positional binds: $1 = month (nullable), $2 = specialty (nullable).
const VISIT_FILTER =
  "v.month_year like '2026-%' and ($1::text is null or v.month_year = $1) and ($2::text is null or v.doctor_specialty = $2)";

function arrow(delta: number): TrendArrow {
  if (delta > 0) return '▲ Increase';
  if (delta < 0) return '▼ Decrease';
  return '▬ No Change';
}

function specialtyParam(s?: string | null): string | null {
  return s ? s.trim() : null;
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

export function listMonths(): string[] {
  return snapshot.months;
}
export function listSpecialties(): string[] {
  return snapshot.specialties;
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
      `, [f.month ?? null, specialtyParam(f.specialty)]);
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
        group by dg.icd_block order by value desc limit $3
      `, [f.month ?? null, specialtyParam(f.specialty), limit]);
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
        group by dg.icd_desc order by value desc limit $3
      `, [f.month ?? null, specialtyParam(f.specialty), 15]);
      return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
    } catch (e) {
      console.warn('getDiseaseDescriptions live query failed, falling back to snapshot:', (e as Error).message);
    }
  }
  return toRank(snapFor(f).topIcdDesc as [string, number][]);
}
export async function getDrugs(f: Filters): Promise<{ ac: RankRow[]; brands: RankRow[] }> {
  if (hasDb) {
    try {
      const [ac, brands] = await Promise.all([
        dbQuery<{ label: string; value: number }>(`
          select d.ac as label, count(*)::int as value
          from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id
          where ${VISIT_FILTER} and d.ac is not null and btrim(d.ac) not in ('', '0')
          group by d.ac order by value desc limit $3
        `, [f.month ?? null, specialtyParam(f.specialty), 15]),
        dbQuery<{ label: string; value: number }>(`
          select lower(btrim(d.brand)) as label, count(*)::int as value
          from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id
          where ${VISIT_FILTER} and d.brand is not null and btrim(d.brand) <> ''
          group by lower(btrim(d.brand)) order by value desc limit $3
        `, [f.month ?? null, specialtyParam(f.specialty), 10]),
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
  return { ac: toRank(s.topAc as [string, number][]), brands: toRank(s.topBrand as [string, number][]) };
}
export async function getDiagnostics(f: Filters): Promise<{ labs: RankRow[]; scans: RankRow[] }> {
  if (hasDb) {
    try {
      const [labs, scans] = await Promise.all([
        dbQuery<{ label: string; value: number }>(`
          select l.tests as label, count(*)::int as value
          from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id
          where ${VISIT_FILTER} and l.tests is not null and btrim(l.tests) <> ''
          group by l.tests order by value desc limit $3
        `, [f.month ?? null, specialtyParam(f.specialty), 10]),
        dbQuery<{ label: string; value: number }>(`
          select s.tests as label, count(*)::int as value
          from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id
          where ${VISIT_FILTER} and s.tests is not null and btrim(s.tests) <> ''
          group by s.tests order by value desc limit $3
        `, [f.month ?? null, specialtyParam(f.specialty), 10]),
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
  return { labs: toRank(s.topLab as [string, number][]), scans: toRank(s.topScan as [string, number][]) };
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
        `, [f.month ?? null, specialtyParam(f.specialty)]),
        dbQuery<{ practitioner: string; specialty: string; visits: number; meds_count: number; labs_count: number }>(`
          with dv as (
            select v.visit_id, v.practitioner_name, v.doctor_specialty
            from healpath.visits v
            where ${VISIT_FILTER} and v.practitioner_name is not null and btrim(v.practitioner_name) <> ''
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
          limit $3
        `, [f.month ?? null, specialtyParam(f.specialty), 20]),
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
  return { ranking: toRank(s.specialty as [string, number][]), doctors: s.doctors as DoctorRow[] };
}

export async function getTrends(specialty?: string | null): Promise<TrendResponse> {
  let points: TrendPoint[] | null = null;
  if (hasDb) {
    try {
      const rows = await dbQuery<{ month: string; meds: number; labs: number; scans: number }>(`
        with mo as (
          select v.month_year as my, count(distinct v.visit_id) as visits
          from healpath.visits v
          where v.month_year like '2026-%' and ($1::text is null or v.doctor_specialty = $1)
          group by v.month_year
        )
        select mo.my as month,
          round((select count(d.brand)::numeric from healpath.drug_fact d join healpath.visits v on v.visit_id = d.visit_id where v.month_year = mo.my and ($1::text is null or v.doctor_specialty = $1)) / nullif(mo.visits, 0), 2) as meds,
          round((select count(l.tests)::numeric from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id where v.month_year = mo.my and ($1::text is null or v.doctor_specialty = $1)) / nullif(mo.visits, 0), 2) as labs,
          round((select count(s.tests)::numeric from healpath.scan_fact s join healpath.visits v on v.visit_id = s.visit_id where v.month_year = mo.my and ($1::text is null or v.doctor_specialty = $1)) / nullif(mo.visits, 0), 2) as scans
        from mo order by mo.my
      `, [specialtyParam(specialty)]);
      if (rows.length) points = rows.map((r) => ({ month: r.month, meds: Number(r.meds), labs: Number(r.labs), scans: Number(r.scans) }));
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
