/**
 * lib/import-core.mjs — SINGLE SOURCE OF TRUTH for the HealPath workbook importer.
 *
 * Extracted from scripts/pg-import.mjs (Sprint 26) so the CLI importer and the
 * Admin → Data Import UI run the exact same parsing, cleaning, and loading code.
 *
 * Cleaning rules (identical to the original importer):
 *   - VisitID trimmed + internal whitespace collapsed
 *   - month_year derived from Year + MonthName; corrupt (<2000) year folded to 2026
 *   - prescription_date nulled for the corrupt <2000 rows
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

export const cleanId = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
export const blankToNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
export function monthYear(year, monthName) {
  const mn = String(monthName ?? '').slice(0, 3);
  const no = MONTH_NO[mn];
  const yr = Number(year);
  if (!no || !yr || yr < 2000) return null;
  return `${yr}-${String(no).padStart(2, '0')}`;
}

const VISIT_COLS = ['visit_id', 'patient_id', 'prescription_date', 'doctor_specialty', 'practitioner_name', 'month_no', 'month_year'];

const FACT_CONFIG = [
  ['Diagnosis_Fact', 'diagnosis_fact', (r) => ({ visit_id: cleanId(r['VisitID']), diseases: blankToNull(r['Diseases']), icd_desc: blankToNull(r['icd desc']), icd_block: blankToNull(r['icd_block']) }), ['visit_id', 'diseases', 'icd_desc', 'icd_block']],
  ['Drug_Fact', 'drug_fact', (r) => ({ visit_id: cleanId(r['VisitID']), medications: blankToNull(r['Medications']), brand: blankToNull(r['brand']), ac: blankToNull(r['AC']) }), ['visit_id', 'medications', 'brand', 'ac']],
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
    const rawYear = Number(r['Year']);
    const year = rawYear >= 2000 ? rawYear : 2026;
    const my = monthYear(year, r['MonthName']);
    const pd = rawYear >= 2000 ? (r['Prescription Date'] ?? null) : null;
    return {
      visit_id: cleanId(r['VisitID']),
      patient_id: Number(r['Patient Id']) || null,
      prescription_date: pd instanceof Date ? pd : (pd ?? null),
      doctor_specialty: blankToNull(r['Doctor Specialty']),
      practitioner_name: blankToNull(r['Practitioner Name']),
      month_no: my ? Number(my.slice(-2)) : null,
      month_year: my,
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

  async function insertChunked(table, cols, rows) {
    const CH = 1000;
    report(table, 0, rows.length);
    for (let i = 0; i < rows.length; i += CH) {
      const chunk = rows.slice(i, i + CH);
      const params = [];
      const tuples = chunk.map((row, ri) => {
        const ph = cols.map((c, ci) => `$${ri * cols.length + ci + 1}`);
        for (const c of cols) params.push(row[c] ?? null);
        return `(${ph.join(',')})`;
      }).join(',');
      const conflict = table === 'visits' ? ' on conflict (visit_id) do nothing' : '';
      await client.query(`insert into healpath.${table} (${cols.join(',')}) values ${tuples}${conflict}`, params);
      report(table, Math.min(i + CH, rows.length), rows.length);
    }
  }

  const t0 = Date.now();
  await client.connect();
  try {
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
