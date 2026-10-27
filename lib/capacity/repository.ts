import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Pool, type PoolClient } from 'pg';

import { SUGGEST_THRESHOLD, canAutoLink, nameScore, type NameScore } from './names';
import type {
  CapacityImportKind,
  ParsedAppointmentRow,
  ParsedLeaveRow,
  ParsedShiftRow,
} from './types';

/**
 * Database work for capacity imports.
 *
 * Writes go through an explicit transaction, so this keeps its own pool rather
 * than using lib/pg.ts, which is pooled per query and cannot hold begin/commit.
 * Same pattern and the same verified-TLS setup as the chronic importer.
 */

// One query per row meant 64,000 sequential round-trips through the TLS pooler,
// which is what made large chronic imports hang. Each chunk below is a single
// query carrying its rows as one jsonb parameter, so the parameter count is
// constant and the 65,535-bind limit never applies.
const INSERT_CHUNK_SIZE = 1000;

const REQUIRED_OBJECTS = [
  'healpath.capacity_specialties',
  'healpath.capacity_practitioners',
  'healpath.capacity_practitioner_aliases',
  'healpath.capacity_import_batches',
  'healpath.capacity_import_files',
  'healpath.capacity_schedule_shifts',
  'healpath.capacity_leave_days',
  'healpath.capacity_appointments',
  'healpath.capacity_settings',
];

let pool: Pool | null = null;

export function getCapacityPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]+/, '');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const ca = readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  pool = new Pool({ connectionString, ssl: { ca, rejectUnauthorized: true }, max: 3 });
  return pool;
}

export class CapacitySchemaMissingError extends Error {
  constructor(readonly missing: string[]) {
    super('The capacity tables are not installed yet. Install the schema from the Capacity import page.');
    this.name = 'CapacitySchemaMissingError';
  }
}

/**
 * Confirm the schema exists rather than creating it. DDL does not belong in the
 * import path: these tables hold curated decisions, and anything that reshapes
 * them on every upload is a hazard.
 */
export async function assertCapacitySchema(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ name: string; present: boolean }>(
    `select x.name, to_regclass(x.name) is not null as present
       from unnest($1::text[]) as x(name)`,
    [REQUIRED_OBJECTS],
  );
  const missing = rows.filter((row) => !row.present).map((row) => row.name);
  if (missing.length) throw new CapacitySchemaMissingError(missing);
}

export async function capacitySchemaStatus(): Promise<{ installed: boolean; missing: string[] }> {
  const client = await getCapacityPool().connect();
  try {
    await assertCapacitySchema(client);
    return { installed: true, missing: [] };
  } catch (error) {
    if (error instanceof CapacitySchemaMissingError) return { installed: false, missing: error.missing };
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------ dimensions ------------------------------- */

/** Insert any specialty names not yet known, and return name -> id. */
export async function resolveSpecialties(
  client: PoolClient,
  names: string[],
): Promise<{ map: Map<string, number>; created: number }> {
  const distinct = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!distinct.length) return { map: new Map(), created: 0 };

  const before = await client.query<{ id: string; name: string }>(
    'select id, name from healpath.capacity_specialties',
  );
  const existing = new Map(before.rows.map((row) => [row.name.toLowerCase().trim(), Number(row.id)]));

  const missing = distinct.filter((name) => !existing.has(name.toLowerCase().trim()));
  if (missing.length) {
    await client.query(
      `insert into healpath.capacity_specialties (name)
       select x.name from jsonb_to_recordset($1::jsonb) as x(name text)
       on conflict (name_key) do nothing`,
      [JSON.stringify(missing.map((name) => ({ name })))],
    );
  }

  const after = await client.query<{ id: string; name: string }>(
    'select id, name from healpath.capacity_specialties',
  );
  const map = new Map<string, number>();
  for (const row of after.rows) map.set(row.name.toLowerCase().trim(), Number(row.id));

  const resolved = new Map<string, number>();
  for (const name of distinct) {
    const id = map.get(name.toLowerCase().trim());
    if (id != null) resolved.set(name, id);
  }
  return { map: resolved, created: missing.length };
}

export interface PractitionerResolution {
  /** normalised name key -> practitioner id */
  map: Map<string, number>;
  created: number;
  autoLinked: number;
  /** Names that found a plausible but not certain match, for human review. */
  needsReview: { name: string; candidate: string; score: number; why: string }[];
}

/**
 * Map every written doctor name to a practitioner row.
 *
 * Resolution order: an existing alias, then an exact key match, then a very
 * high scoring fuzzy match, and otherwise a new practitioner. Anything merely
 * plausible is reported for review rather than merged — crediting one doctor's
 * hours to another is the failure this feature has already suffered once, and
 * it is far harder to undo than a pending link is to confirm.
 */
export async function resolvePractitioners(
  client: PoolClient,
  entries: { key: string; display: string; specialtyId?: number | null }[],
): Promise<PractitionerResolution> {
  const wanted = new Map<string, { display: string; specialtyId?: number | null }>();
  for (const entry of entries) {
    if (!entry.key) continue;
    const current = wanted.get(entry.key);
    // Keep the longest spelling seen: it carries the most information.
    if (!current || entry.display.length > current.display.length) {
      wanted.set(entry.key, { display: entry.display, specialtyId: entry.specialtyId ?? current?.specialtyId });
    }
  }
  if (!wanted.size) return { map: new Map(), created: 0, autoLinked: 0, needsReview: [] };

  const existing = await client.query<{ id: string; name_key: string; display_name: string }>(
    'select id, name_key, display_name from healpath.capacity_practitioners',
  );
  const byKey = new Map(existing.rows.map((row) => [row.name_key, Number(row.id)]));
  const roster = existing.rows.map((row) => ({ key: row.name_key, display: row.display_name }));

  const aliases = await client.query<{ alias_key: string; practitioner_id: string; source: string }>(
    'select alias_key, practitioner_id, source from healpath.capacity_practitioner_aliases',
  );
  const byAlias = new Map(
    aliases.rows.filter((row) => row.source !== 'rejected').map((row) => [row.alias_key, Number(row.practitioner_id)]),
  );
  const rejected = new Set(aliases.rows.filter((row) => row.source === 'rejected').map((row) => row.alias_key));

  const map = new Map<string, number>();
  const toCreate: { key: string; display: string; specialtyId: number | null }[] = [];
  const toAlias: { key: string; display: string; id: number; score: number; why: string }[] = [];
  const needsReview: PractitionerResolution['needsReview'] = [];

  for (const [key, entry] of wanted) {
    const viaAlias = byAlias.get(key);
    if (viaAlias != null) {
      map.set(key, viaAlias);
      continue;
    }
    const viaKey = byKey.get(key);
    if (viaKey != null) {
      map.set(key, viaKey);
      continue;
    }

    // Keep the runner-up: two candidates that score nearly the same mean the
    // match is a coin toss, and that is never safe to apply unattended.
    let best: { key: string; display: string; score: NameScore } | null = null;
    let runnerUp: NameScore | null = null;
    for (const candidate of roster) {
      const score = nameScore(entry.display, candidate.display);
      if (!best || score.s > best.score.s) {
        runnerUp = best ? best.score : runnerUp;
        best = { key: candidate.key, display: candidate.display, score };
      } else if (!runnerUp || score.s > runnerUp.s) {
        runnerUp = score;
      }
    }

    if (best && !rejected.has(key) && canAutoLink(best.score, runnerUp)) {
      const id = byKey.get(best.key);
      if (id != null) {
        map.set(key, id);
        toAlias.push({ key, display: entry.display, id, score: best.score.s, why: best.score.why });
        continue;
      }
    }

    toCreate.push({ key, display: entry.display, specialtyId: entry.specialtyId ?? null });
    if (best && best.score.s >= SUGGEST_THRESHOLD) {
      needsReview.push({
        name: entry.display,
        candidate: best.display,
        score: best.score.s,
        why: best.score.why,
      });
    }
  }

  if (toCreate.length) {
    await client.query(
      `insert into healpath.capacity_practitioners (display_name, name_key, specialty_id)
       select x.display_name, x.name_key, x.specialty_id
         from jsonb_to_recordset($1::jsonb)
              as x(display_name text, name_key text, specialty_id bigint)
       on conflict (name_key) do nothing`,
      [
        JSON.stringify(
          toCreate.map((row) => ({ display_name: row.display, name_key: row.key, specialty_id: row.specialtyId })),
        ),
      ],
    );
    const refreshed = await client.query<{ id: string; name_key: string }>(
      `select id, name_key from healpath.capacity_practitioners where name_key = any($1::text[])`,
      [toCreate.map((row) => row.key)],
    );
    for (const row of refreshed.rows) map.set(row.name_key, Number(row.id));
  }

  if (toAlias.length) {
    await client.query(
      `insert into healpath.capacity_practitioner_aliases
         (alias_key, alias_display, practitioner_id, source, confidence, match_reason)
       select x.alias_key, x.alias_display, x.practitioner_id, 'auto', x.confidence, x.match_reason
         from jsonb_to_recordset($1::jsonb)
              as x(alias_key text, alias_display text, practitioner_id bigint,
                   confidence numeric, match_reason text)
       on conflict (alias_key) do nothing`,
      [
        JSON.stringify(
          toAlias.map((row) => ({
            alias_key: row.key,
            alias_display: row.display,
            practitioner_id: row.id,
            confidence: Number(row.score.toFixed(3)),
            match_reason: row.why,
          })),
        ),
      ],
    );
  }

  return { map, created: toCreate.length, autoLinked: toAlias.length, needsReview };
}

/* -------------------------------- writes --------------------------------- */

/**
 * Clear the dates an import covers before inserting.
 *
 * A correction is a fresh export of the same period, so replacing the window
 * wholesale is the only way the numbers cannot end up doubled. All of a month's
 * schedule workbooks travel in one batch for exactly this reason: replacing per
 * file would delete the other clinic's rows for the same days.
 */
export async function deleteWindow(
  client: PoolClient,
  kind: CapacityImportKind,
  start: string,
  end: string,
): Promise<number> {
  if (kind === 'appointments') {
    const result = await client.query(
      'delete from healpath.capacity_appointments where appt_date between $1 and $2',
      [start, end],
    );
    return result.rowCount ?? 0;
  }
  const shifts = await client.query(
    'delete from healpath.capacity_schedule_shifts where work_date between $1 and $2',
    [start, end],
  );
  const leave = await client.query(
    'delete from healpath.capacity_leave_days where work_date between $1 and $2',
    [start, end],
  );
  return (shifts.rowCount ?? 0) + (leave.rowCount ?? 0);
}

export async function countWindow(
  client: PoolClient,
  kind: CapacityImportKind,
  start: string,
  end: string,
): Promise<number> {
  const sql =
    kind === 'appointments'
      ? 'select count(*)::int as n from healpath.capacity_appointments where appt_date between $1 and $2'
      : `select (select count(*) from healpath.capacity_schedule_shifts where work_date between $1 and $2)
               + (select count(*) from healpath.capacity_leave_days where work_date between $1 and $2) as n`;
  const { rows } = await client.query<{ n: number }>(sql, [start, end]);
  return Number(rows[0]?.n ?? 0);
}

async function insertChunks<T>(
  client: PoolClient,
  rows: T[],
  sql: string,
  trace?: (message: string) => void,
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    const result = await client.query(sql, [JSON.stringify(chunk)]);
    written += result.rowCount ?? chunk.length;
    trace?.(`inserted ${Math.min(offset + INSERT_CHUNK_SIZE, rows.length)} / ${rows.length}`);
  }
  return written;
}

export async function insertShifts(
  client: PoolClient,
  batchId: string,
  rows: ParsedShiftRow[],
  practitioners: Map<string, number>,
  specialties: Map<string, number>,
  trace?: (message: string) => void,
): Promise<number> {
  const payload = rows
    .map((row) => ({
      batch_id: batchId,
      work_date: row.workDate,
      practitioner_id: practitioners.get(row.doctorKey) ?? null,
      source_doctor_text: row.doctorText,
      specialty_id: row.specialtyText ? specialties.get(row.specialtyText) ?? null : null,
      source_specialty_text: row.specialtyText,
      start_min: row.startMin,
      end_min: row.endMin,
      carried_from_date: row.carriedFromDate,
      note: row.note,
      source_sheet: row.sourceSheet,
      source_row: row.sourceRow,
    }))
    .filter((row) => row.practitioner_id != null);

  return insertChunks(
    client,
    payload,
    `insert into healpath.capacity_schedule_shifts
       (batch_id, work_date, practitioner_id, source_doctor_text, specialty_id,
        source_specialty_text, start_min, end_min, carried_from_date, note, source_sheet, source_row)
     select x.batch_id, x.work_date, x.practitioner_id, x.source_doctor_text, x.specialty_id,
            x.source_specialty_text, x.start_min, x.end_min, x.carried_from_date, x.note, x.source_sheet, x.source_row
       from jsonb_to_recordset($1::jsonb)
            as x(batch_id uuid, work_date date, practitioner_id bigint, source_doctor_text text,
                 specialty_id bigint, source_specialty_text text, start_min smallint, end_min smallint,
                 carried_from_date date, note text, source_sheet text, source_row integer)
     on conflict (work_date, practitioner_id, start_min, end_min) do nothing`,
    trace,
  );
}

export async function insertLeave(
  client: PoolClient,
  batchId: string,
  rows: ParsedLeaveRow[],
  practitioners: Map<string, number>,
  specialties: Map<string, number>,
  trace?: (message: string) => void,
): Promise<number> {
  const payload = rows
    .map((row) => ({
      batch_id: batchId,
      work_date: row.workDate,
      practitioner_id: practitioners.get(row.doctorKey) ?? null,
      source_doctor_text: row.doctorText,
      specialty_id: row.specialtyText ? specialties.get(row.specialtyText) ?? null : null,
      source_specialty_text: row.specialtyText,
      leave_kind: row.leaveKind,
      planned_minutes: row.plannedMinutes,
      note: row.note,
      source_sheet: row.sourceSheet,
      source_row: row.sourceRow,
    }))
    .filter((row) => row.practitioner_id != null);

  return insertChunks(
    client,
    payload,
    `insert into healpath.capacity_leave_days
       (batch_id, work_date, practitioner_id, source_doctor_text, specialty_id,
        source_specialty_text, leave_kind, planned_minutes, note, source_sheet, source_row)
     select x.batch_id, x.work_date, x.practitioner_id, x.source_doctor_text, x.specialty_id,
            x.source_specialty_text, x.leave_kind, x.planned_minutes, x.note, x.source_sheet, x.source_row
       from jsonb_to_recordset($1::jsonb)
            as x(batch_id uuid, work_date date, practitioner_id bigint, source_doctor_text text,
                 specialty_id bigint, source_specialty_text text, leave_kind text,
                 planned_minutes smallint, note text, source_sheet text, source_row integer)
     on conflict (work_date, practitioner_id, leave_kind) do nothing`,
    trace,
  );
}

export async function insertAppointments(
  client: PoolClient,
  batchId: string,
  rows: ParsedAppointmentRow[],
  practitioners: Map<string, number>,
  specialties: Map<string, number>,
  trace?: (message: string) => void,
): Promise<number> {
  const payload = rows
    .map((row) => ({
      batch_id: batchId,
      appt_date: row.apptDate,
      start_min: row.startMin,
      duration_min: row.durationMin,
      practitioner_id: practitioners.get(row.doctorKey) ?? null,
      source_doctor_text: row.doctorText,
      specialty_id: row.specialtyText ? specialties.get(row.specialtyText) ?? null : null,
      source_specialty_text: row.specialtyText,
      status_raw: row.statusRaw,
      status_bucket: row.statusBucket,
      appt_type: row.apptType,
      appt_mode: row.apptMode,
      cancel_reason: row.cancelReason,
    }))
    .filter((row) => row.practitioner_id != null);

  return insertChunks(
    client,
    payload,
    `insert into healpath.capacity_appointments
       (batch_id, appt_date, start_min, duration_min, practitioner_id, source_doctor_text,
        specialty_id, source_specialty_text, status_raw, status_bucket, appt_type, appt_mode, cancel_reason)
     select x.batch_id, x.appt_date, x.start_min, x.duration_min, x.practitioner_id, x.source_doctor_text,
            x.specialty_id, x.source_specialty_text, x.status_raw, x.status_bucket, x.appt_type, x.appt_mode, x.cancel_reason
       from jsonb_to_recordset($1::jsonb)
            as x(batch_id uuid, appt_date date, start_min smallint, duration_min smallint,
                 practitioner_id bigint, source_doctor_text text, specialty_id bigint,
                 source_specialty_text text, status_raw text, status_bucket text,
                 appt_type text, appt_mode text, cancel_reason text)`,
    trace,
  );
}

/** Has this exact file already been imported? */
export async function findFileByHash(
  client: PoolClient,
  fileHash: string,
): Promise<{ batchId: string; fileName: string; completedAt: string | null } | null> {
  const { rows } = await client.query<{ batch_id: string; file_name: string; completed_at: string | null }>(
    `select f.batch_id, f.file_name, b.completed_at
       from healpath.capacity_import_files f
       join healpath.capacity_import_batches b on b.id = f.batch_id
      where f.file_hash = $1 and b.status = 'COMPLETED'
      limit 1`,
    [fileHash],
  );
  if (!rows.length) return null;
  return { batchId: rows[0].batch_id, fileName: rows[0].file_name, completedAt: rows[0].completed_at };
}

export const CAPACITY_INSERT_CHUNK_SIZE = INSERT_CHUNK_SIZE;
