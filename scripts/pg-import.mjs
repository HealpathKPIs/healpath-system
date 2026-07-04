/**
 * scripts/pg-import.mjs — direct-Postgres loader + validation for the HealPath
 * Session Pooler (Supabase). Additive to scripts/import.ts; does not modify it.
 *
 * Connection uses verified TLS against Supabase's CA (certs/prod-ca-2021.crt) —
 * verification stays ON (rejectUnauthorized default true).
 *
 * Data cleaning rules are IDENTICAL to scripts/import.ts:
 *   - VisitID trimmed + internal whitespace collapsed
 *   - month_year derived from Year + MonthName; corrupt (<2000) year folded to 2026
 *   - prescription_date nulled for the corrupt <2000 rows
 *   - blank text -> null
 * Additionally (required by the DB's enforced FK visit_id -> visits): fact rows
 * whose visit_id is blank or does not exist in visits are skipped and reported.
 *
 * Usage: node scripts/pg-import.mjs [path/to/HealPath_BI_Starter.xlsx]
 */
import fs from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const FILE = process.argv[2] || 'C:/Users/User/Downloads/HealPath_BI_Starter.xlsx';
const CA = fs.readFileSync('certs/prod-ca-2021.crt', 'utf8');
const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.searchParams.delete('sslmode'); // explicit verified ssl:{ca} is authoritative

// --- cleaning rules (identical to scripts/import.ts) --------------------------
const MONTH_NO = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const cleanId = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const blankToNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
function monthYear(year, monthName) {
  const mn = String(monthName ?? '').slice(0, 3);
  const no = MONTH_NO[mn];
  const yr = Number(year);
  if (!no || !yr || yr < 2000) return null;
  return `${yr}-${String(no).padStart(2, '0')}`;
}

const wb = XLSX.readFile(FILE, { cellDates: true });
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n]);

// --- visits -------------------------------------------------------------------
const visitsRaw = sheet('Visit');
const visits = visitsRaw.map((r) => {
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

// --- fact tables --------------------------------------------------------------
const factConfig = [
  ['Diagnosis_Fact', 'diagnosis_fact', (r) => ({ visit_id: cleanId(r['VisitID']), diseases: blankToNull(r['Diseases']), icd_desc: blankToNull(r['icd desc']), icd_block: blankToNull(r['icd_block']) }), ['visit_id', 'diseases', 'icd_desc', 'icd_block']],
  ['Drug_Fact', 'drug_fact', (r) => ({ visit_id: cleanId(r['VisitID']), medications: blankToNull(r['Medications']), brand: blankToNull(r['brand']), ac: blankToNull(r['AC']) }), ['visit_id', 'medications', 'brand', 'ac']],
  ['Lab_Fact', 'lab_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) }), ['visit_id', 'tests']],
  ['Scan_Fact', 'scan_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) }), ['visit_id', 'tests']],
];

const facts = {};
const skips = {};
for (const [sheetName, table, map, cols] of factConfig) {
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

// Referential-integrity handling: the FK visit_id -> visits is enforced by the
// DB, and these orphan VisitIDs are proven absent from the Visit extract. Per
// instruction we SKIP exactly those fact rows (never fabricate parent visits),
// and record them for the import report.
const totalOrphans = Object.values(skips).reduce((a, s) => a + s.orphan, 0);
if (totalOrphans > 0) {
  console.warn(`\nSkipping ${totalOrphans} orphan fact row(s) whose VisitID has no matching visit (proven; skipped per instruction, not fabricated):`);
  for (const [t, s] of Object.entries(skips)) {
    if (s.orphan) console.warn(`  ${t}: skip ${s.orphan} row(s); example VisitIDs ${JSON.stringify(s.orphanExamples)}`);
  }
}

const client = new pg.Client({ connectionString: dbUrl.toString(), ssl: { ca: CA } });

async function insertChunked(table, cols, rows) {
  const CH = 1000;
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
  }
}

const t0 = Date.now();
await client.connect();
console.log('TLS-verified connection established.');
try {
  await client.query('begin');
  console.log(`Loading visits (${visits.length})...`);
  await insertChunked('visits', ['visit_id', 'patient_id', 'prescription_date', 'doctor_specialty', 'practitioner_name', 'month_no', 'month_year'], visits);
  for (const [, table] of factConfig) {
    console.log(`Loading ${table} (${facts[table].rows.length})...`);
    await insertChunked(table, facts[table].cols, facts[table].rows);
  }
  await client.query('commit');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('\nLOAD FAILED — transaction rolled back. Full error:');
  console.error(JSON.stringify(Object.getOwnPropertyNames(e).reduce((o, k) => { o[k] = e[k]; return o; }, {}), null, 2));
  await client.end();
  process.exit(1);
}
const loadMs = Date.now() - t0;

// --- validation ---------------------------------------------------------------
const WORKBOOK = { visits: 86329, diagnosis_fact: 116808, drug_fact: 207136, lab_fact: 68355, scan_fact: 10014 };
const tables = ['visits', 'diagnosis_fact', 'drug_fact', 'lab_fact', 'scan_fact'];
const facttabs = ['diagnosis_fact', 'drug_fact', 'lab_fact', 'scan_fact'];

const report = { loadMs, tables: {}, fk: {}, skips };
for (const t of tables) {
  const c = (await client.query(`select count(*)::int n from healpath.${t}`)).rows[0].n;
  const d = (await client.query(`select count(distinct visit_id)::int n from healpath.${t}`)).rows[0].n;
  const nulls = (await client.query(`select count(*)::int n from healpath.${t} where visit_id is null`)).rows[0].n;
  report.tables[t] = { count: c, distinctVisitId: d, nullVisitId: nulls, workbook: WORKBOOK[t] };
}
for (const t of facttabs) {
  const orphans = (await client.query(`select count(*)::int n from healpath.${t} f left join healpath.visits v on v.visit_id = f.visit_id where v.visit_id is null`)).rows[0].n;
  report.fk[t] = orphans;
}
await client.end();

// --- output -------------------------------------------------------------------
console.log('\n================= VALIDATION =================');
console.log('table            db_count   distinct_vid   null_vid   workbook   expected_loaded   match');
for (const t of tables) {
  const r = report.tables[t];
  const expected = t === 'visits' ? WORKBOOK[t] : skips[t].loaded;
  const match = r.count === expected ? 'OK' : 'MISMATCH';
  console.log(
    t.padEnd(16),
    String(r.count).padStart(8),
    String(r.distinctVisitId).padStart(13),
    String(r.nullVisitId).padStart(10),
    String(r.workbook).padStart(10),
    String(expected).padStart(16),
    '  ' + match,
  );
}
console.log('\nFK integrity (orphan fact rows referencing a missing visit — must be 0):');
for (const t of facttabs) console.log('  ' + t.padEnd(16), report.fk[t]);
console.log('\nSkipped source rows (blank or FK-orphan visit_id):');
for (const t of facttabs) {
  const s = skips[t];
  console.log(`  ${t.padEnd(16)} source=${s.source} loaded=${s.loaded} blank=${s.blank} orphan=${s.orphan}`, s.orphan ? `e.g. ${JSON.stringify(s.orphanExamples)}` : '');
}
console.log(`\nLoad duration: ${(loadMs / 1000).toFixed(1)}s`);
console.log('\n<<<REPORT_JSON>>>' + JSON.stringify(report) + '<<<END_REPORT_JSON>>>');
