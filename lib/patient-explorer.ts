import { dbQuery, hasDb } from './pg';
import { PatientMasterRepository } from './patient-master-repository';
import { getRiskCarrierOptions, listDoctors, listMonths, listSpecialties } from './queries';
import type { RankRow } from './types';

const CHRONIC_CONSULTANT = "coalesce(nullif(btrim(row_data->>'Consultant Name'), ''), 'Unassigned')";
const CHRONIC_PATIENT_NAME = "nullif(btrim(row_data->>'Patient Name'), '')";
const CHRONIC_ACTIVE_INGREDIENT = "coalesce(nullif(btrim(c.row_data->>'Active Ingrdient'), ''), nullif(btrim(c.row_data->>'Active Ingredient'), ''))";
const CHRONIC_DISEASE_TEXT = `
  exists (
    select 1
    from jsonb_each_text(c.row_data) disease_entry(key, value)
    where regexp_replace(lower(btrim(disease_entry.key)), '[^a-z0-9]', '', 'g') like 'diseasedescription%'
      and btrim(disease_entry.value) <> ''
      and disease_entry.value ilike '%' || $6 || '%'
  )`;

export interface PatientExplorerFilters {
  month?: string | null;
  specialty?: string | null;
  doctor?: string | null;
  riskCarrier?: string | null;
  consultant?: string | null;
  disease?: string | null;
  medication?: string | null;
  activeIngredient?: string | null;
  q?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
  sort?: string | null;
  dir?: string | null;
}

export interface PatientExplorerRow {
  patientId: string;
  patientName: string;
  riskCarrier: string | null;
  acuteVisits: number;
  chronicReviews: number;
  latestAcuteVisit: string | null;
  latestChronicReview: string | null;
  acuteStatus: 'Acute Only' | 'Acute + Chronic' | 'No Acute';
  chronicStatus: 'Chronic Only' | 'Acute + Chronic' | 'No Chronic';
  status: 'Acute Only' | 'Chronic Only' | 'Acute + Chronic';
}

export interface PatientExplorerKpis {
  totalPatients: number;
  acutePatients: number;
  chronicPatients: number;
  bothPatients: number;
  acuteVisits: number;
  chronicReviews: number;
  avgAcuteVisitsPerPatient: number;
  avgChronicReviewsPerPatient: number;
}

export interface PatientExplorerStats {
  patientsReturned: number;
  acuteRecordsReturned: number;
  chronicRecordsReturned: number;
  lastUpdated: string | null;
  currentFilters: { label: string; value: string }[];
}

export interface PatientExplorerOptions {
  months: string[];
  doctors: string[];
  specialties: string[];
  riskCarriers: string[];
  consultants: string[];
}

export interface PatientExplorerData {
  filters: Required<Pick<PatientExplorerFilters, 'month' | 'specialty' | 'doctor' | 'riskCarrier' | 'consultant' | 'disease' | 'medication' | 'activeIngredient' | 'q' | 'sort' | 'dir'>> & { page: number; pageSize: number };
  options: PatientExplorerOptions;
  kpis: PatientExplorerKpis;
  stats: PatientExplorerStats;
  distributions: {
    riskCarriers: RankRow[];
    doctors: RankRow[];
    diseases: RankRow[];
    medications: RankRow[];
    consultants: RankRow[];
  };
  rows: PatientExplorerRow[];
  totalRows: number;
  totalPages: number;
}

const SORTS: Record<string, string> = {
  patientId: 'patient_id',
  patientName: 'patient_name',
  riskCarrier: 'risk_carrier',
  acuteVisits: 'acute_visits',
  chronicReviews: 'chronic_reviews',
  latestAcuteVisit: 'latest_acute_visit',
  latestChronicReview: 'latest_chronic_review',
  acuteStatus: 'acute_status',
  chronicStatus: 'chronic_status',
  status: 'status',
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function pageNumber(value?: string | number | null) {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function pageSizeNumber(value?: string | number | null) {
  const n = Number(value ?? 25);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(100, Math.max(10, Math.floor(n)));
}

function normalizeFilters(input: PatientExplorerFilters) {
  const sort = SORTS[input.sort ?? ''] ? String(input.sort) : 'latestAcuteVisit';
  const dir = input.dir?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  return {
    month: clean(input.month),
    specialty: clean(input.specialty),
    doctor: clean(input.doctor),
    riskCarrier: clean(input.riskCarrier),
    consultant: clean(input.consultant),
    disease: clean(input.disease),
    medication: clean(input.medication),
    activeIngredient: clean(input.activeIngredient),
    q: clean(input.q),
    page: pageNumber(input.page),
    pageSize: pageSizeNumber(input.pageSize),
    sort,
    dir,
  };
}

function paramsFor(f: ReturnType<typeof normalizeFilters>) {
  return [
    f.month,
    f.specialty,
    f.doctor,
    f.riskCarrier,
    f.consultant,
    f.disease,
    f.medication,
    f.activeIngredient,
    f.q ? `%${f.q}%` : null,
  ];
}

function explorerCte() {
  const acuteJoin = PatientMasterRepository.acuteJoin('v', 'pm');
  const chronicPreJoin = PatientMasterRepository.chronicJoin('cp', 'pm_pre');
  const chronicPostJoin = PatientMasterRepository.chronicJoin('cpo', 'pm_post');
  return `
    with acute_filtered as (
      select v.patient_id::text as patient_id,
        pm.risk_carrier,
        v.visit_id,
        v.prescription_date,
        v.practitioner_name,
        v.doctor_specialty
      from healpath.visits v
      ${acuteJoin}
      where v.month_year like '2026-%'
        and ($1::text is null or v.month_year = $1)
        and ($2::text is null or v.doctor_specialty = $2)
        and ($3::text is null or v.practitioner_name = $3)
        and ($4::text is null or pm.risk_carrier = $4)
        and ($6::text is null or exists (
          select 1 from healpath.diagnosis_fact dg
          where dg.visit_id = v.visit_id
            and (dg.icd_block = $6 or dg.icd_desc ilike '%' || $6 || '%' or dg.diseases ilike '%' || $6 || '%')
        ))
        and ($7::text is null or exists (
          select 1 from healpath.drug_fact d
          where d.visit_id = v.visit_id
            and (d.medications ilike '%' || $7 || '%' or d.brand ilike '%' || $7 || '%' or d.ac ilike '%' || $7 || '%')
        ))
        and ($8::text is null or exists (
          select 1 from healpath.drug_fact d
          where d.visit_id = v.visit_id and d.ac ilike '%' || $8 || '%'
        ))
    ),
    chronic_filtered as (
      select *
      from (
        select 'pre'::text as phase,
          btrim(cp.patient_id) as patient_id,
          ${CHRONIC_PATIENT_NAME} as patient_name,
          pm_pre.risk_carrier,
          cp.week,
          cp.medication_name,
          cp.imported_at,
          cp.month_order,
          cp.year,
          cp.row_data,
          ${CHRONIC_CONSULTANT} as consultant
        from healpath.chronic_pre cp
        ${chronicPreJoin}
        union all
        select 'post'::text as phase,
          btrim(cpo.patient_id) as patient_id,
          ${CHRONIC_PATIENT_NAME} as patient_name,
          pm_post.risk_carrier,
          cpo.week,
          cpo.medication_name,
          cpo.imported_at,
          cpo.month_order,
          cpo.year,
          cpo.row_data,
          ${CHRONIC_CONSULTANT} as consultant
        from healpath.chronic_post cpo
        ${chronicPostJoin}
      ) c
      where ($1::text is null or (c.year is not null and c.month_order is not null and to_char(make_date(c.year, c.month_order, 1), 'YYYY-MM') = $1))
        and ($4::text is null or c.risk_carrier = $4)
        and ($5::text is null or c.consultant = $5)
        and ($6::text is null or ${CHRONIC_DISEASE_TEXT})
        and ($7::text is null or c.medication_name ilike '%' || $7 || '%')
        and ($8::text is null or ${CHRONIC_ACTIVE_INGREDIENT} ilike '%' || $8 || '%')
    ),
    acute_patients as (
      select patient_id,
        max(risk_carrier) as risk_carrier,
        count(distinct visit_id)::int as acute_visits,
        max(prescription_date) as latest_acute_visit
      from acute_filtered
      group by patient_id
    ),
    chronic_patients as (
      select patient_id,
        max(patient_name) filter (where patient_name is not null) as patient_name,
        max(risk_carrier) as risk_carrier,
        count(*)::int as chronic_reviews,
        max(imported_at) as latest_chronic_review
      from chronic_filtered
      group by patient_id
    ),
    patients as (
      select
        coalesce(a.patient_id, c.patient_id) as patient_id,
        coalesce(c.patient_name, 'Unknown') as patient_name,
        coalesce(a.risk_carrier, c.risk_carrier) as risk_carrier,
        coalesce(a.acute_visits, 0)::int as acute_visits,
        coalesce(c.chronic_reviews, 0)::int as chronic_reviews,
        a.latest_acute_visit,
        c.latest_chronic_review,
        case
          when a.patient_id is not null and c.patient_id is not null then 'Acute + Chronic'
          when a.patient_id is not null then 'Acute Only'
          else 'Chronic Only'
        end as status,
        case
          when a.patient_id is not null and c.patient_id is not null then 'Acute + Chronic'
          when a.patient_id is not null then 'Acute Only'
          else 'No Acute'
        end as acute_status,
        case
          when a.patient_id is not null and c.patient_id is not null then 'Acute + Chronic'
          when c.patient_id is not null then 'Chronic Only'
          else 'No Chronic'
        end as chronic_status
      from acute_patients a
      full outer join chronic_patients c on c.patient_id = a.patient_id
      where (($2::text is null and $3::text is null) or a.patient_id is not null)
        and ($5::text is null or c.patient_id is not null)
    ),
    searched_patients as (
      select *
      from patients
      where ($9::text is null or patient_id ilike $9 or patient_name ilike $9)
    )`;
}

function filtersForDisplay(f: ReturnType<typeof normalizeFilters>) {
  return [
    ['Month', f.month],
    ['Specialty', f.specialty],
    ['Doctor', f.doctor],
    ['Risk Carrier', f.riskCarrier],
    ['Consultant', f.consultant],
    ['Disease', f.disease],
    ['Medication', f.medication],
    ['Active Ingredient', f.activeIngredient],
    ['Search', f.q],
  ].map(([label, value]) => ({ label: label!, value: value || 'All' }));
}

function mapPatientRow(row: Record<string, unknown>): PatientExplorerRow {
  const status = String(row.status) as PatientExplorerRow['status'];
  return {
    patientId: String(row.patient_id),
    patientName: String(row.patient_name ?? 'Unknown'),
    riskCarrier: row.risk_carrier ? String(row.risk_carrier) : null,
    acuteVisits: Number(row.acute_visits ?? 0),
    chronicReviews: Number(row.chronic_reviews ?? 0),
    latestAcuteVisit: row.latest_acute_visit ? String(row.latest_acute_visit) : null,
    latestChronicReview: row.latest_chronic_review ? String(row.latest_chronic_review) : null,
    acuteStatus: String(row.acute_status) as PatientExplorerRow['acuteStatus'],
    chronicStatus: String(row.chronic_status) as PatientExplorerRow['chronicStatus'],
    status,
  };
}

async function getConsultants() {
  if (!hasDb) return [];
  const rows = await dbQuery<{ consultant: string }>(`
    select distinct consultant
    from (
      select ${CHRONIC_CONSULTANT} as consultant from healpath.chronic_pre
      union
      select ${CHRONIC_CONSULTANT} as consultant from healpath.chronic_post
    ) c
    where consultant is not null and btrim(consultant) <> ''
      and consultant not in ('1 Months','2 Month','3 Months','4 Months','5 Months','6 Months')
    order by consultant
  `);
  return rows.map((row) => row.consultant);
}

export async function getPatientExplorerOptions(): Promise<PatientExplorerOptions> {
  const [riskCarriers, consultants] = await Promise.all([
    getRiskCarrierOptions(),
    getConsultants().catch(() => []),
  ]);
  return {
    months: listMonths(),
    doctors: listDoctors(),
    specialties: listSpecialties(),
    riskCarriers,
    consultants,
  };
}

export async function getPatientExplorerData(input: PatientExplorerFilters): Promise<PatientExplorerData> {
  const filters = normalizeFilters(input);
  const options = await getPatientExplorerOptions();
  if (!hasDb) {
    return {
      filters,
      options,
      kpis: {
        totalPatients: 0,
        acutePatients: 0,
        chronicPatients: 0,
        bothPatients: 0,
        acuteVisits: 0,
        chronicReviews: 0,
        avgAcuteVisitsPerPatient: 0,
        avgChronicReviewsPerPatient: 0,
      },
      stats: { patientsReturned: 0, acuteRecordsReturned: 0, chronicRecordsReturned: 0, lastUpdated: null, currentFilters: filtersForDisplay(filters) },
      distributions: { riskCarriers: [], doctors: [], diseases: [], medications: [], consultants: [] },
      rows: [],
      totalRows: 0,
      totalPages: 1,
    };
  }

  const orderBy = SORTS[filters.sort];
  const params = paramsFor(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const cte = explorerCte();
  const queryParams = [...params, filters.pageSize, offset];

  const [
    summaryRows,
    patientRows,
    riskRows,
    doctorRows,
    diseaseRows,
    medicationRows,
    consultantRows,
    updatedRows,
  ] = await Promise.all([
    dbQuery<Record<string, unknown>>(`${cte}
      select count(*)::int as total_patients,
        count(*) filter (where acute_visits > 0)::int as acute_patients,
        count(*) filter (where chronic_reviews > 0)::int as chronic_patients,
        count(*) filter (where acute_visits > 0 and chronic_reviews > 0)::int as both_patients,
        coalesce(sum(acute_visits), 0)::int as acute_visits,
        coalesce(sum(chronic_reviews), 0)::int as chronic_reviews
      from searched_patients
    `, params),
    dbQuery<Record<string, unknown>>(`${cte}
      select patient_id, patient_name, risk_carrier, acute_visits, chronic_reviews,
        to_char(latest_acute_visit, 'YYYY-MM-DD') as latest_acute_visit,
        to_char(latest_chronic_review, 'YYYY-MM-DD HH24:MI') as latest_chronic_review,
        acute_status, chronic_status, status
      from searched_patients
      order by ${orderBy} ${filters.dir}, patient_id asc
      limit $10 offset $11
    `, queryParams),
    dbQuery<RankRow>(`${cte}
      select coalesce(risk_carrier, 'Unknown') as label, count(*)::int as value
      from searched_patients
      group by label
      order by value desc, label asc
      limit 10
    `, params),
    dbQuery<RankRow>(`${cte}
      select af.practitioner_name as label, count(distinct af.patient_id)::int as value
      from acute_filtered af
      join searched_patients sp on sp.patient_id = af.patient_id
      where af.practitioner_name is not null and btrim(af.practitioner_name) <> ''
      group by af.practitioner_name
      order by value desc, label asc
      limit 10
    `, params),
    dbQuery<RankRow>(`${cte}
      select label, count(distinct patient_id)::int as value
      from (
        select af.patient_id, coalesce(nullif(btrim(dg.icd_block), ''), nullif(btrim(dg.icd_desc), ''), nullif(btrim(dg.diseases), '')) as label
        from acute_filtered af
        join searched_patients sp on sp.patient_id = af.patient_id
        join healpath.diagnosis_fact dg on dg.visit_id = af.visit_id
        union all
        select cf.patient_id, btrim(disease_entry.value) as label
        from chronic_filtered cf
        join searched_patients sp on sp.patient_id = cf.patient_id
        join lateral jsonb_each_text(cf.row_data) disease_entry(key, value)
          on regexp_replace(lower(btrim(disease_entry.key)), '[^a-z0-9]', '', 'g') like 'diseasedescription%'
          and btrim(disease_entry.value) <> ''
      ) d
      where label is not null and btrim(label) <> ''
      group by label
      order by value desc, label asc
      limit 10
    `, params),
    dbQuery<RankRow>(`${cte}
      select label, count(distinct patient_id)::int as value
      from (
        select af.patient_id, coalesce(nullif(btrim(d.ac), ''), nullif(btrim(d.medications), ''), nullif(btrim(d.brand), '')) as label
        from acute_filtered af
        join searched_patients sp on sp.patient_id = af.patient_id
        join healpath.drug_fact d on d.visit_id = af.visit_id
        union all
        select cf.patient_id, nullif(btrim(cf.medication_name), '') as label
        from chronic_filtered cf
        join searched_patients sp on sp.patient_id = cf.patient_id
      ) meds
      where label is not null and btrim(label) <> ''
      group by label
      order by value desc, label asc
      limit 10
    `, params),
    dbQuery<RankRow>(`${cte}
      select cf.consultant as label, count(distinct cf.patient_id)::int as value
      from chronic_filtered cf
      join searched_patients sp on sp.patient_id = cf.patient_id
      where cf.consultant is not null and btrim(cf.consultant) <> ''
      group by cf.consultant
      order by value desc, label asc
      limit 10
    `, params),
    dbQuery<{ last_updated: string | null }>(`
      select greatest(
        coalesce((select max(prescription_date) from healpath.visits), '-infinity'::timestamptz),
        coalesce((select max(imported_at) from healpath.chronic_pre), '-infinity'::timestamptz),
        coalesce((select max(imported_at) from healpath.chronic_post), '-infinity'::timestamptz),
        coalesce((select max(updated_at) from healpath.patient_master), '-infinity'::timestamptz)
      )::text as last_updated
    `),
  ]);

  const summary = summaryRows[0] ?? {};
  const totalRows = Number(summary.total_patients ?? 0);
  const acutePatients = Number(summary.acute_patients ?? 0);
  const chronicPatients = Number(summary.chronic_patients ?? 0);
  const acuteVisits = Number(summary.acute_visits ?? 0);
  const chronicReviews = Number(summary.chronic_reviews ?? 0);
  const kpis: PatientExplorerKpis = {
    totalPatients: totalRows,
    acutePatients,
    chronicPatients,
    bothPatients: Number(summary.both_patients ?? 0),
    acuteVisits,
    chronicReviews,
    avgAcuteVisitsPerPatient: acutePatients ? Number((acuteVisits / acutePatients).toFixed(2)) : 0,
    avgChronicReviewsPerPatient: chronicPatients ? Number((chronicReviews / chronicPatients).toFixed(2)) : 0,
  };

  return {
    filters,
    options,
    kpis,
    stats: {
      patientsReturned: totalRows,
      acuteRecordsReturned: acuteVisits,
      chronicRecordsReturned: chronicReviews,
      lastUpdated: updatedRows[0]?.last_updated ?? null,
      currentFilters: filtersForDisplay(filters),
    },
    distributions: {
      riskCarriers: riskRows,
      doctors: doctorRows,
      diseases: diseaseRows,
      medications: medicationRows,
      consultants: consultantRows,
    },
    rows: patientRows.map(mapPatientRow),
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / filters.pageSize)),
  };
}

export async function getPatientExplorerExportRows(input: PatientExplorerFilters, limit = 10000): Promise<PatientExplorerRow[]> {
  const filters = normalizeFilters({ ...input, page: 1, pageSize: 100 });
  if (!hasDb) return [];
  const orderBy = SORTS[filters.sort];
  const rows = await dbQuery<Record<string, unknown>>(`${explorerCte()}
    select patient_id, patient_name, risk_carrier, acute_visits, chronic_reviews,
      to_char(latest_acute_visit, 'YYYY-MM-DD') as latest_acute_visit,
      to_char(latest_chronic_review, 'YYYY-MM-DD HH24:MI') as latest_chronic_review,
      acute_status, chronic_status, status
    from searched_patients
    order by ${orderBy} ${filters.dir}, patient_id asc
    limit $10
  `, [...paramsFor(filters), limit]);
  return rows.map(mapPatientRow);
}

export function patientExplorerExportFields(row: PatientExplorerRow) {
  return {
    'Patient ID': row.patientId,
    'Patient Name': row.patientName,
    'Risk Carrier': row.riskCarrier ?? 'Unknown',
    'Acute Visits': row.acuteVisits,
    'Chronic Reviews': row.chronicReviews,
    'Latest Visit': row.latestAcuteVisit ?? '',
    'Latest Review': row.latestChronicReview ?? '',
    Status: row.status,
  };
}
