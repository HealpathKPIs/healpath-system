import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { Pool, type PoolClient } from 'pg';
import {
  type ChronicCalendarEntry,
  CHRONIC_CALENDAR_SEED,
  chronicEntryForWeek,
  chronicMissingWeeks,
  chronicPeriodsForWeeks,
  chronicWeekRangeLabel,
  chronicYm,
} from '@/lib/chronic-calendar';
import {
  type ChronicParsedRow,
  type ChronicSheetName,
  parseWorkbook,
} from '@/lib/chronic-parser';
import {
  type ChronicNormalizationLogEntry,
  normalizeChronicRows,
} from '@/lib/chronic-normalizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let pool: Pool | null = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]+/, '');
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const ca = readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  pool = new Pool({
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
    max: 3,
  });
  return pool;
}

/**
 * Resolve every parsed row's Week through the business calendar (the single
 * source of truth), filling month/month_name/year/period/month_order, and build
 * the upload summary (periods found, week range, missing weeks). A week the
 * calendar does not know is an error (extend healpath.chronic_calendar). Missing
 * weeks within a covered period are informational only.
 */
function resolveCalendar(parsed: Record<ChronicSheetName, ChronicParsedRow[]>, calendar: ChronicCalendarEntry[]) {
  const errors: string[] = [];
  const allRows = Object.values(parsed).flat();
  for (const row of allRows) {
    const entry = chronicEntryForWeek(calendar, row.week);
    if (!entry) {
      errors.push(`Week ${row.week} is not in the business calendar. Add it to healpath.chronic_calendar.`);
      continue;
    }
    row.month_name = entry.month_name;
    row.year = entry.year;
    row.month_order = entry.month_order;
    row.period = entry.period;
    row.month = chronicYm(entry.month_name, entry.year);
  }

  const allWeeks = new Set(allRows.map((row) => row.week));
  const periodsFound = chronicPeriodsForWeeks(calendar, allWeeks).map((entry) => entry.period);
  const weekRange = chronicWeekRangeLabel(allWeeks);
  const missingWeeks = chronicMissingWeeks(calendar, allWeeks);
  const periodLabel = periodsFound.length === 0
    ? ''
    : periodsFound.length === 1
      ? periodsFound[0]
      : `${periodsFound[0]} → ${periodsFound[periodsFound.length - 1]}`;
  const batchId = weekRange === '-' ? '' : `W${weekRange}`;
  for (const row of allRows) row.batch_id = batchId;

  return {
    errors: Array.from(new Set(errors)),
    weeks: Array.from(allWeeks),
    periodsFound,
    periodLabel,
    weekRange,
    missingWeeks,
    batchId,
  };
}

// The business calendar table is the single source of truth. It is created and
// seeded with weeks 1..28 idempotently; the seed never overwrites rows added
// later (on conflict do nothing), so extending it with weeks 29, 30, 31 … needs
// no code change — only new rows.
async function ensureCalendar(client: PoolClient) {
  await client.query(`
    create table if not exists healpath.chronic_calendar (
      week integer primary key,
      month_name text not null,
      year integer not null,
      month_order integer not null,
      period text not null
    )
  `);
  await client.query(
    `
      insert into healpath.chronic_calendar (week, month_name, year, month_order, period)
      select x.week, x.month_name, x.year, x.month_order, x.period
      from jsonb_to_recordset($1::jsonb) as x(week int, month_name text, year int, month_order int, period text)
      on conflict (week) do nothing
    `,
    [JSON.stringify(CHRONIC_CALENDAR_SEED)],
  );
}

async function loadCalendar(client: PoolClient): Promise<ChronicCalendarEntry[]> {
  const result = await client.query('select week, month_name, year, month_order, period from healpath.chronic_calendar order by month_order, week');
  return result.rows.map((row) => ({
    week: Number(row.week),
    month_name: row.month_name,
    year: Number(row.year),
    month_order: Number(row.month_order),
    period: row.period,
  }));
}

async function ensureTables(client: PoolClient) {
  await client.query(`
    create table if not exists healpath.chronic_import_batches (
      id bigserial primary key,
      batch_id text not null,
      week text not null,
      month text not null,
      file_name text not null,
      imported_at timestamptz not null default now(),
      pre_rows integer not null default 0,
      post_rows integer not null default 0,
      status text not null,
      duration_ms integer not null default 0
    )
  `);
  for (const table of ['chronic_pre', 'chronic_post']) {
    await client.query(`
      create table if not exists healpath.${table} (
        id bigserial primary key,
        batch_id text not null,
        week text not null,
        month text not null,
        patient_id text not null,
        recommendation text not null,
        issue text,
        medication_name text not null,
        row_data jsonb not null default '{}'::jsonb,
        imported_at timestamptz not null default now()
      )
    `);
    // Additive business-calendar columns, all resolved from the calendar table.
    // Safe to run repeatedly on pre-existing tables.
    await client.query(`alter table healpath.${table} add column if not exists month_name text`);
    await client.query(`alter table healpath.${table} add column if not exists month_order integer`);
    await client.query(`alter table healpath.${table} add column if not exists year integer`);
    await client.query(`alter table healpath.${table} add column if not exists period text`);
    await client.query(`
      create unique index if not exists ${table}_week_patient_medication_uidx
      on healpath.${table} (week, patient_id, medication_name)
    `);
  }
  // Normalization audit trail (Sprint 35): one row per distinct
  // Original -> Normalized change per import batch, with the reason
  // ('mapped' rule, fuzzy 'normalized', or 'unknown' kept-as-is).
  await client.query(`
    create table if not exists healpath.chronic_normalization_log (
      id bigserial primary key,
      batch_id text not null,
      field text not null,
      original text not null,
      normalized text not null,
      reason text not null,
      occurrences integer not null default 1,
      imported_at timestamptz not null default now()
    )
  `);
  await ensureCalendar(client);
}

async function insertNormalizationLog(client: PoolClient, batchId: string, entries: ChronicNormalizationLogEntry[]) {
  if (!entries.length) return;
  await client.query(
    `
      insert into healpath.chronic_normalization_log (batch_id, field, original, normalized, reason, occurrences)
      select $1, x.field, x.original, x.normalized, x.reason, x.occurrences
      from jsonb_to_recordset($2::jsonb) as x(field text, original text, normalized text, reason text, occurrences integer)
    `,
    [batchId, JSON.stringify(entries)],
  );
}

function uniqueKeys(rows: ChronicParsedRow[]) {
  return Array.from(new Set(rows.map((row) => `${row.week}\u0000${row.patient_id}\u0000${row.medication_name}`)));
}

function keyParts(key: string) {
  const [week, patient_id, medication_name] = key.split('\u0000');
  return { week, patient_id, medication_name };
}

function parsedDuplicateReport(sheet: ChronicSheetName, rows: ChronicParsedRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.week}\u0000${row.patient_id}\u0000${row.medication_name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicatedKeys = Array.from(counts.entries()).filter(([, count]) => count > 1);
  return {
    sheet,
    totalParsedRows: rows.length,
    distinctKeys: counts.size,
    duplicateKeyCount: duplicatedKeys.length,
    firstDuplicatedKey: duplicatedKeys[0] ? keyParts(duplicatedKeys[0][0]) : null,
    firstDuplicatedKeyOccurrences: duplicatedKeys[0]?.[1] ?? 0,
  };
}

async function duplicateExists(client: PoolClient, table: 'chronic_pre' | 'chronic_post', rows: ChronicParsedRow[]) {
  const keys = uniqueKeys(rows);
  if (!keys.length) return false;
  const values = keys.map((key) => {
    const [week, patientId, medicationName] = key.split('\u0000');
    return [week, patientId, medicationName];
  });
  const result = await client.query(
    `
      select 1
      from healpath.${table} t
      join jsonb_to_recordset($1::jsonb) as x(week text, patient_id text, medication_name text)
        on t.week = x.week
       and t.patient_id = x.patient_id
       and t.medication_name = x.medication_name
      limit 1
    `,
    [JSON.stringify(values.map(([week, patient_id, medication_name]) => ({ week, patient_id, medication_name })))],
  );
  return Boolean(result.rowCount);
}

// Bulk insert (Sprint 33.5I). The old implementation sent ONE query per row —
// 41k rows meant 41k sequential round-trips through the TLS pooler, which is
// why large imports hung. Each chunk is now a single query carrying all rows
// as one jsonb parameter (constant parameter count — no 65,535-bind limit
// concern), expanded server-side by jsonb_to_recordset. Same transaction, same
// schema, same columns: any failed chunk throws, the caller's catch rolls the
// whole transaction back, and commit happens only after every chunk succeeds.
const INSERT_CHUNK_SIZE = 1000;

async function insertRows(
  client: PoolClient,
  table: 'chronic_pre' | 'chronic_post',
  rows: ChronicParsedRow[],
  log?: (message: string) => void,
) {
  const label = table === 'chronic_pre' ? 'PRE' : 'POST';
  const chunkCount = Math.ceil(rows.length / INSERT_CHUNK_SIZE);
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    const chunkNo = Math.floor(offset / INSERT_CHUNK_SIZE) + 1;
    log?.(`${label} chunk ${chunkNo}/${chunkCount} (${chunk.length} rows)`);
    const payload = chunk.map((row) => ({
      batch_id: row.batch_id,
      week: row.week,
      month: row.month,
      month_name: row.month_name,
      month_order: row.month_order,
      year: row.year,
      period: row.period,
      patient_id: row.patient_id,
      recommendation: row.recommendation,
      issue: row.issue,
      medication_name: row.medication_name,
      row_data: row.row_data,
    }));
    await client.query(
      `
        insert into healpath.${table}
          (batch_id, week, month, month_name, month_order, year, period, patient_id, recommendation, issue, medication_name, row_data)
        select x.batch_id, x.week, x.month, x.month_name, x.month_order, x.year, x.period, x.patient_id, x.recommendation, x.issue, x.medication_name, x.row_data
        from jsonb_to_recordset($1::jsonb) as x(
          batch_id text,
          week text,
          month text,
          month_name text,
          month_order integer,
          year integer,
          period text,
          patient_id text,
          recommendation text,
          issue text,
          medication_name text,
          row_data jsonb
        )
      `,
      [JSON.stringify(payload)],
    );
  }
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  // Sprint 33.5H2 hang trace — logs only, no logic changes. The last line
  // printed before silence identifies where a Pending request is stuck.
  const trace = (message: string) => console.log(`[chronic-import +${Date.now() - started}ms] ${message}`);
  trace('1. POST handler entered');

  trace('2. Reading FormData');
  const form = await req.formData();
  trace('2b. FormData read');
  const file = form.get('file');
  const mode = String(form.get('mode') ?? 'preview');

  if (!(file instanceof File)) {
    trace('15. Response returned (400 no file)');
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  trace(`3. Workbook received (${file.name}, ${file.size} bytes, mode=${mode})`);

  let workbook;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    trace('6. parseWorkbook started');
    workbook = parseWorkbook(bytes, CHRONIC_CALENDAR_SEED, trace);
    trace('7. parseWorkbook finished');
  } catch (error) {
    trace(`15. Response returned (422 parse error: ${(error as Error).message})`);
    return NextResponse.json({ error: (error as Error).message }, { status: 422 });
  }

  trace(`8. Validation finished (${workbook.errors.length} error(s))`);
  if (workbook.errors.length) {
    trace('15. Response returned (422 validation errors)');
    return NextResponse.json({ errors: workbook.errors, preview: workbook.preview }, { status: 422 });
  }

  if (mode === 'preview') {
    // Informational only (no DB write): resolve against the seed calendar and
    // dry-run the normalization layer so the report is visible before import.
    const summary = resolveCalendar(workbook.parsed, CHRONIC_CALENDAR_SEED);
    const normalization = normalizeChronicRows([...(workbook.parsed.Pre ?? []), ...(workbook.parsed.Post ?? [])]);
    trace('15. Response returned (preview)');
    return NextResponse.json({
      preview: workbook.preview,
      periods: summary.periodsFound,
      weeks: summary.weeks,
      weekRange: summary.weekRange,
      missingWeeks: summary.missingWeeks,
      normalization: normalization.report,
    });
  }

  trace('9a. Acquiring database client from pool');
  const client = await getPool().connect();
  trace('9b. Database client acquired');
  try {
    trace('9. Beginning database transaction');
    await client.query('begin');
    trace('9c. Transaction begun; ensuring tables');
    await ensureTables(client);
    trace('9d. Tables ensured; loading calendar');

    // Resolve every row through the authoritative DB calendar.
    const calendar = await loadCalendar(client);
    trace(`9e. Calendar loaded (${calendar.length} weeks)`);
    const summary = resolveCalendar(workbook.parsed, calendar);
    if (summary.errors.length) {
      await client.query('rollback');
      trace('15. Response returned (422 calendar errors)');
      return NextResponse.json({ errors: summary.errors, preview: workbook.preview }, { status: 422 });
    }

    const preRows = workbook.parsed.Pre ?? [];
    const postRows = workbook.parsed.Post ?? [];

    // Data Normalization layer (Sprint 35): every row passes through
    // normalizeChronicRow BEFORE anything is written — issue column + every
    // Issue N field inside row_data + recommendation infrastructure.
    trace('9n. Normalizing rows');
    const normalization = normalizeChronicRows([...preRows, ...postRows]);
    trace(`9o. Normalization finished (rows ${normalization.report.rows}, normalized ${normalization.report.normalized}, mapped ${normalization.report.mapped}, unknown ${normalization.report.unknown})`);

    const parsedKeyDiagnostics = [
      parsedDuplicateReport('Pre', preRows),
      parsedDuplicateReport('Post', postRows),
    ];
    const firstParsedDuplicate = parsedKeyDiagnostics.find((diagnostic) => diagnostic.firstDuplicatedKey);
    if (firstParsedDuplicate) {
      console.error('Chronic import duplicate parsed key before INSERT', firstParsedDuplicate);
      await client.query('rollback');
      trace('15. Response returned (422 duplicate parsed rows)');
      return NextResponse.json({
        error: 'Duplicate parsed rows detected before INSERT.',
        diagnostics: parsedKeyDiagnostics,
        firstDuplicatedKey: firstParsedDuplicate.firstDuplicatedKey,
        preview: workbook.preview,
      }, { status: 422 });
    }

    trace('9f. Checking for existing duplicates');
    if (await duplicateExists(client, 'chronic_pre', preRows) || await duplicateExists(client, 'chronic_post', postRows)) {
      await client.query('rollback');
      trace('15. Response returned (409 duplicates)');
      return NextResponse.json({ error: 'Duplicate records detected.' }, { status: 409 });
    }
    trace('9g. Duplicate check finished');

    trace(`10. Inserting PRE (${preRows.length} rows)`);
    await insertRows(client, 'chronic_pre', preRows, trace);
    trace('11. PRE inserted');
    trace(`12. Inserting POST (${postRows.length} rows)`);
    await insertRows(client, 'chronic_post', postRows, trace);
    trace('13. POST inserted');
    const durationMs = Date.now() - started;
    const patients = new Set([...preRows, ...postRows].map((row) => row.patient_id));
    await client.query(
      `
        insert into healpath.chronic_import_batches
          (batch_id, week, month, file_name, imported_at, pre_rows, post_rows, status, duration_ms)
        values ($1, $2, $3, $4, now(), $5, $6, $7, $8)
      `,
      [summary.batchId, summary.weekRange, summary.periodLabel, file.name, preRows.length, postRows.length, 'completed', durationMs],
    );
    trace(`13b. Writing normalization log (${normalization.log.length} distinct changes)`);
    await insertNormalizationLog(client, summary.batchId, normalization.log);
    trace('14. Commit');
    await client.query('commit');
    trace('14b. Commit finished');

    trace('15. Response returned (success)');
    return NextResponse.json({
      batch: {
        batch_id: summary.batchId,
        week: summary.weekRange,
        month: summary.periodLabel,
        file_name: file.name,
        imported_at: new Date().toISOString(),
        pre_rows: preRows.length,
        post_rows: postRows.length,
        status: 'completed',
      },
      importedRows: preRows.length + postRows.length,
      patients: patients.size,
      weeks: summary.weeks,
      periods: summary.periodsFound,
      weekRange: summary.weekRange,
      missingWeeks: summary.missingWeeks,
      normalization: normalization.report,
      durationMs,
    });
  } catch (error) {
    trace(`ERROR in transaction: ${(error as Error).message}`);
    await client.query('rollback').catch(() => undefined);
    trace('15. Response returned (500)');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    client.release();
    trace('client released');
  }
}

// The client import preview reads the business calendar from here so it, too,
// reflects new weeks with no code change. Falls back to the seed if the DB is
// unavailable.
export async function GET() {
  try {
    const client = await getPool().connect();
    try {
      await ensureCalendar(client);
      const calendar = await loadCalendar(client);
      return NextResponse.json({ calendar });
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ calendar: CHRONIC_CALENDAR_SEED });
  }
}
