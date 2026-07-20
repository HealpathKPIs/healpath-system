import { dbQuery, hasDb } from '@/lib/pg';
import type { PatientMasterRow } from '@/lib/patient-master-parser';

export type PatientMasterQueryExecutor = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

export interface PatientMasterRecord {
  patient_id: string;
  risk_carrier: string;
  created_at: string;
  updated_at: string;
}

export interface PatientMasterImportCounts {
  inserted: number;
  updated: number;
}

export interface PatientMasterStats {
  lastImportAt: string | null;
  rowsImported: number;
  currentCount: number;
}

export class PatientMasterRepository {
  constructor(private readonly query: PatientMasterQueryExecutor = dbQuery) {}

  static acuteJoin(visitAlias = 'v', patientMasterAlias = 'pm') {
    return `left join healpath.patient_master ${patientMasterAlias} on ${patientMasterAlias}.patient_id = ${visitAlias}.patient_id::bigint`;
  }

  static chronicJoin(chronicAlias = 'c', patientMasterAlias = 'pm') {
    return `left join healpath.patient_master ${patientMasterAlias} on ${patientMasterAlias}.patient_id = cast(nullif(btrim(${chronicAlias}.row_data->>'INDIVIDUAL NUMBER'), '') as bigint)`;
  }

  static riskCarrierSelect(patientMasterAlias = 'pm') {
    return `${patientMasterAlias}.risk_carrier as risk_carrier`;
  }

  async ensureTable() {
    if (!hasDb) throw new Error('DATABASE_URL is not configured.');
    await this.query('create schema if not exists healpath');
    await this.query(`
      create table if not exists healpath.patient_master (
        patient_id bigint primary key,
        risk_carrier text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await this.query('create index if not exists idx_patient_master_risk_carrier on healpath.patient_master (risk_carrier)');
    await this.query('create index if not exists idx_patient_master_updated_at on healpath.patient_master (updated_at desc)');
  }

  async upsertRows(rows: PatientMasterRow[]): Promise<PatientMasterImportCounts> {
    await this.ensureTable();
    if (!rows.length) return { inserted: 0, updated: 0 };

    const result = await this.query<{ inserted: number; updated: number }>(
      `
        with incoming as (
          select x.patient_id::bigint as patient_id, btrim(x.risk_carrier) as risk_carrier
          from jsonb_to_recordset($1::jsonb) as x(patient_id text, risk_carrier text)
        ),
        existing as (
          select i.patient_id, (pm.patient_id is not null) as existed
          from incoming i
          left join healpath.patient_master pm on pm.patient_id = i.patient_id
        ),
        upserted as (
          insert into healpath.patient_master (patient_id, risk_carrier, created_at, updated_at)
          select patient_id, risk_carrier, now(), now()
          from incoming
          on conflict (patient_id) do update
            set risk_carrier = excluded.risk_carrier,
                updated_at = now()
          returning patient_id
        )
        select
          count(*) filter (where not existed)::int as inserted,
          count(*) filter (where existed)::int as updated
        from existing
      `,
      [JSON.stringify(rows)],
    );

    return {
      inserted: Number(result[0]?.inserted ?? 0),
      updated: Number(result[0]?.updated ?? 0),
    };
  }

  async getPatient(patientId: string | number): Promise<PatientMasterRecord | null> {
    await this.ensureTable();
    const rows = await this.query<PatientMasterRecord>(
      `
        select patient_id::text, risk_carrier, created_at::text, updated_at::text
        from healpath.patient_master
        where patient_id = $1::bigint
      `,
      [String(patientId)],
    );
    return rows[0] ?? null;
  }

  async getRiskCarrier(patientId: string | number): Promise<string | null> {
    const patient = await this.getPatient(patientId);
    return patient?.risk_carrier ?? null;
  }

  async getAllRiskCarriers(): Promise<string[]> {
    await this.ensureTable();
    const rows = await this.query<{ risk_carrier: string }>(
      `
        select distinct btrim(risk_carrier) as risk_carrier
        from healpath.patient_master
        where risk_carrier is not null and btrim(risk_carrier) <> ''
        order by 1
      `,
    );
    return rows.map((row) => row.risk_carrier);
  }

  async getStats(): Promise<PatientMasterStats> {
    await this.ensureTable();
    const rows = await this.query<PatientMasterStats>(
      `
        with stats as (
          select max(updated_at) as last_import_at, count(*)::int as current_count
          from healpath.patient_master
        )
        select
          stats.last_import_at::text as "lastImportAt",
          coalesce((
            select count(*)::int
            from healpath.patient_master pm
            where stats.last_import_at is not null
              and pm.updated_at = stats.last_import_at
          ), 0) as "rowsImported",
          stats.current_count as "currentCount"
        from stats
      `,
    );
    return rows[0] ?? { lastImportAt: null, rowsImported: 0, currentCount: 0 };
  }

  private static readonly defaultRepository = new PatientMasterRepository();

  static ensureTable() {
    return this.defaultRepository.ensureTable();
  }

  static upsertRows(rows: PatientMasterRow[]): Promise<PatientMasterImportCounts> {
    return this.defaultRepository.upsertRows(rows);
  }

  static getPatient(patientId: string | number): Promise<PatientMasterRecord | null> {
    return this.defaultRepository.getPatient(patientId);
  }

  static getRiskCarrier(patientId: string | number): Promise<string | null> {
    return this.defaultRepository.getRiskCarrier(patientId);
  }

  static getAllRiskCarriers(): Promise<string[]> {
    return this.defaultRepository.getAllRiskCarriers();
  }

  static getStats(): Promise<PatientMasterStats> {
    return this.defaultRepository.getStats();
  }
}
