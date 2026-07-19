/**
 * lib/import-core.mjs — SINGLE SOURCE OF TRUTH for the HealPath workbook importer.
 *
 * Extracted from scripts/pg-import.mjs (Sprint 26) so the CLI importer and the
 * Admin → Data Import UI run the exact same parsing, cleaning, and loading code.
 *
 * Cleaning rules:
 *   - VisitID trimmed + internal whitespace collapsed
 *   - prescription_date parsed directly from the Visit sheet Prescription Date
 *   - year/month fields accepted from Excel when present, otherwise derived from prescription_date
 *   - Doctor Specialty / Doctor Speciality both map to doctor_specialty
 *   - blank text -> null
 *   - fact rows whose visit_id is blank or has no parent visit are SKIPPED and
 *     reported (FK visit_id -> visits is enforced; parents are never fabricated)
 *
 * Loading: verified-TLS direct Postgres (Supabase Session Pooler), one
 * transaction, visits first then the four fact tables, chunked 1000 rows.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createRequire } from 'node:module';
// Load xlsx's CJS build explicitly — identical behaviour under the Node CLI and
// the Next.js (webpack) server bundle, avoiding the dual-package ESM interop trap.
const XLSX = createRequire(import.meta.url)('xlsx');

const MONTH_NO = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const MONTH_NAME = Object.fromEntries(Object.entries(MONTH_NO).map(([name, no]) => [no, name]));

export const cleanId = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
export const blankToNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
export const normalizeHeader = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizedRow = (row) => new Map(Object.keys(row).map((key) => [normalizeHeader(key), key]));
const readField = (row, index, aliases) => {
  for (const alias of aliases) {
    const key = index.get(normalizeHeader(alias));
    if (key !== undefined) return row[key];
  }
  return undefined;
};

function parseExcelDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
  }
  const s = String(value).trim();
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? s : date;
}

const dateYear = (value) => value instanceof Date && !Number.isNaN(value.getTime()) ? value.getFullYear() : null;
const dateMonthNo = (value) => value instanceof Date && !Number.isNaN(value.getTime()) ? value.getMonth() + 1 : null;
const cleanNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export function monthYear(year, monthName) {
  const mn = String(monthName ?? '').slice(0, 3);
  const no = MONTH_NO[mn];
  const yr = Number(year);
  if (!no || !yr || yr < 2000) return null;
  return `${yr}-${String(no).padStart(2, '0')}`;
}

const VISIT_COLS = ['visit_id', 'patient_id', 'prescription_date', 'doctor_specialty', 'practitioner_name', 'month_no', 'month_year'];
const VISIT_UPSERT_COLS = ['patient_id', 'prescription_date', 'doctor_specialty', 'practitioner_name', 'month_no', 'month_year'];
const DRUG_FACT_UNIQUE_INDEX = 'drug_fact_visit_id_medications_uidx';
const DRUG_FACT_UPSERT_COLS = ['ac', 'brand', 'medications'];

const FACT_CONFIG = [
  ['Diagnosis_Fact', 'diagnosis_fact', (r) => ({ visit_id: cleanId(r['VisitID']), diseases: blankToNull(r['Diseases']), icd_desc: blankToNull(r['icd desc']), icd_block: blankToNull(r['icd_block']) }), ['visit_id', 'diseases', 'icd_desc', 'icd_block']],
  ['Drug_Fact', 'drug_fact', (r) => {
    const fields = normalizedRow(r);
    return {
      visit_id: cleanId(readField(r, fields, ['VisitID', 'Visit ID'])),
      medications: blankToNull(readField(r, fields, ['Medications', 'Medication'])),
      brand: blankToNull(readField(r, fields, ['brand', 'Brand'])),
      ac: blankToNull(readField(r, fields, ['AC', 'Active Ingredient', 'ActiveIngredient', 'Column1'])),
    };
  }, ['visit_id', 'medications', 'brand', 'ac']],
  ['Lab_Fact', 'lab_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) }), ['visit_id', 'tests']],
  ['Scan_Fact', 'scan_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) }), ['visit_id', 'tests']],
];

export const TABLE_ORDER = ['visits', 'diagnosis_fact', 'drug_fact', 'lab_fact', 'scan_fact'];

/** Parse + clean a workbook (file path or Buffer). NO database access. */
export function parseWorkbook(input) {
  // Always parse from a Buffer (XLSX.read) — readFile needs fs wiring that the
  // bundled ESM build lacks, so file paths are read via node:fs first.
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  if (!wb.Sheets['Visit']) throw new Error("Workbook is missing the 'Visit' sheet");
  const sheet = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]) : []);

  const visits = sheet('Visit').map((r) => {
    const fields = normalizedRow(r);
    const excelPrescriptionDate = readField(r, fields, ['Prescription Date']);
    const prescriptionDate = parseExcelDate(excelPrescriptionDate);
    const rawYear = cleanNumber(readField(r, fields, ['Year']));
    const rawMonthNo = cleanNumber(readField(r, fields, ['MonthNo', 'Month No', 'Month']));
    const rawMonthName = blankToNull(readField(r, fields, ['MonthName', 'Month Name']));
    const derivedYear = rawYear && rawYear >= 2000 ? rawYear : dateYear(prescriptionDate);
    const derivedMonthNo = rawMonthNo || dateMonthNo(prescriptionDate);
    const derivedMonthName = rawMonthName || (derivedMonthNo ? MONTH_NAME[derivedMonthNo] : null);
    const my = monthYear(derivedYear, derivedMonthName);
    return {
      visit_id: cleanId(readField(r, fields, ['VisitID', 'Visit ID'])),
      patient_id: Number(readField(r, fields, ['Patient Id', 'Patient ID'])) || null,
      prescription_date: prescriptionDate,
      doctor_specialty: blankToNull(readField(r, fields, ['Doctor Specialty', 'Doctor Speciality'])),
      practitioner_name: blankToNull(readField(r, fields, ['Practitioner Name'])),
      year: derivedYear,
      month_no: derivedMonthNo,
      month_name: derivedMonthName,
      month_year: my,
      __trace: {
        excelPrescriptionDate,
        parsedDate: prescriptionDate,
        derivedYear,
        derivedMonth: derivedMonthName ? `${derivedMonthName} (${derivedMonthNo})` : derivedMonthNo,
      },
    };
  });
  const visitIds = new Set(visits.map((v) => v.visit_id).filter((x) => x !== ''));

  const facts = {};
  const skips = {};
  for (const [sheetName, table, map, cols] of FACT_CONFIG) {
    const all = sheet(sheetName).map(map);
    const kept = [];
    let blank = 0;
    const orphan = [];
    for (const row of all) {
      if (!row.visit_id) { blank += 1; continue; }
      if (!visitIds.has(row.visit_id)) { orphan.push(row.visit_id); continue; }
      kept.push(row);
    }
    facts[table] = { rows: kept, cols };
    skips[table] = { source: all.length, blank, orphan: orphan.length, loaded: kept.length, orphanExamples: [...new Set(orphan)].slice(0, 5) };
  }

  const counts = { visits: visits.length };
  for (const t of Object.keys(facts)) counts[t] = facts[t].rows.length;
  return { visits, facts, skips, counts };
}

/**
 * Load a parsed workbook into Postgres in one transaction.
 * onProgress({ table, inserted, total }) fires per table start and per chunk.
 */
export async function loadDatabase(parsed, { onProgress } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  const dbUrl = new URL(url);
  dbUrl.searchParams.delete('sslmode'); // explicit verified ssl:{ca} is authoritative
  const ca = fs.readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const client = new pg.Client({ connectionString: dbUrl.toString(), ssl: { ca } });

  const report = (table, inserted, total) => { if (onProgress) onProgress({ table, inserted, total }); };
  const visitTraceLimit = Math.max(0, Number(process.env.VISIT_IMPORT_TRACE_LIMIT ?? 10) || 0);
  let visitTraceCount = 0;
  const traceVisitUpsert = (chunk, results) => {
    if (visitTraceCount >= visitTraceLimit) return;
    for (let i = 0; i < chunk.length && visitTraceCount < visitTraceLimit; i += 1) {
      const trace = chunk[i].__trace ?? {};
      console.log('[visit-import trace]', JSON.stringify({
        visit_id: chunk[i].visit_id,
        excelPrescriptionDate: trace.excelPrescriptionDate ?? null,
        parsedDate: trace.parsedDate instanceof Date ? trace.parsedDate.toISOString() : trace.parsedDate ?? null,
        derivedYear: trace.derivedYear ?? null,
        derivedMonth: trace.derivedMonth ?? null,
        insertedUpdated: results[i]?.inserted ? 'Inserted' : 'Updated',
      }));
      visitTraceCount += 1;
    }
  };
  const traceTableActions = (table, inserted, updated, skipped = 0) => {
    console.log(`[${table} import] Inserted=${inserted} Updated=${updated} Skipped=${skipped}`);
  };

  async function insertChunked(table, cols, rows) {
    const CH = 1000;
    const skipped = [];
    const importRows = table === 'drug_fact'
      ? rows.filter((row) => {
          const keep = row.visit_id && row.medications;
          if (!keep) skipped.push(row);
          return keep;
        })
      : rows;
    if (table === 'drug_fact' && skipped.length) traceTableActions(table, 0, 0, skipped.length);
    report(table, 0, importRows.length);
    for (let i = 0; i < importRows.length; i += CH) {
      const chunk = importRows.slice(i, i + CH);
      const params = [];
      const tuples = chunk.map((row, ri) => {
        const ph = cols.map((c, ci) => `$${ri * cols.length + ci + 1}`);
        for (const c of cols) params.push(row[c] ?? null);
        return `(${ph.join(',')})`;
      }).join(',');
      if (table === 'visits') {
        const updates = VISIT_UPSERT_COLS.map((c) => `${c}=excluded.${c}`).join(',');
        const result = await client.query(
          `insert into healpath.${table} (${cols.join(',')}) values ${tuples} on conflict (visit_id) do update set ${updates} returning visit_id, (xmax = 0) as inserted`,
          params,
        );
        traceVisitUpsert(chunk, result.rows);
      } else if (table === 'drug_fact') {
        const updates = DRUG_FACT_UPSERT_COLS.map((c) => `${c}=excluded.${c}`).join(',');
        const result = await client.query(
          `insert into healpath.${table} (${cols.join(',')}) values ${tuples} on conflict (visit_id, medications) do update set ${updates} returning visit_id, medications, (xmax = 0) as inserted`,
          params,
        );
        const inserted = result.rows.filter((row) => row.inserted).length;
        const updated = result.rows.length - inserted;
        traceTableActions(table, inserted, updated, 0);
      } else {
        await client.query(`insert into healpath.${table} (${cols.join(',')}) values ${tuples}`, params);
      }
      report(table, Math.min(i + CH, importRows.length), importRows.length);
    }
  }

  const t0 = Date.now();
  await client.connect();
  try {
    await client.query(`create unique index if not exists ${DRUG_FACT_UNIQUE_INDEX} on healpath.drug_fact (visit_id, medications)`);
    await client.query('begin');
    await insertChunked('visits', VISIT_COLS, parsed.visits);
    for (const [, table] of FACT_CONFIG) {
      await insertChunked(table, parsed.facts[table].cols, parsed.facts[table].rows);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    await client.end().catch(() => {});
    throw e;
  }
  await client.end();
  return { loadMs: Date.now() - t0, loaded: { ...parsed.counts } };
}

/** Post-load validation: COUNT(*), COUNT(DISTINCT visit_id), NULL visit_id, FK orphans. */
export async function validateDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  const dbUrl = new URL(url);
  dbUrl.searchParams.delete('sslmode');
  const ca = fs.readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const client = new pg.Client({ connectionString: dbUrl.toString(), ssl: { ca } });
  await client.connect();
  const report = { tables: {}, fk: {} };
  try {
    for (const t of TABLE_ORDER) {
      const c = (await client.query(`select count(*)::int n from healpath.${t}`)).rows[0].n;
      const d = (await client.query(`select count(distinct visit_id)::int n from healpath.${t}`)).rows[0].n;
      const nulls = (await client.query(`select count(*)::int n from healpath.${t} where visit_id is null`)).rows[0].n;
      report.tables[t] = { count: c, distinctVisitId: d, nullVisitId: nulls };
    }
    for (const t of TABLE_ORDER.slice(1)) {
      const orphans = (await client.query(`select count(*)::int n from healpath.${t} f left join healpath.visits v on v.visit_id = f.visit_id where v.visit_id is null`)).rows[0].n;
      report.fk[t] = orphans;
    }
  } finally {
    await client.end().catch(() => {});
  }
  return report;
}
