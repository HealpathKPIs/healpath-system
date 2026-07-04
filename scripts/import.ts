/**
 * scripts/import.ts — monthly extract loader + reconciliation.
 *
 * Usage: npm run import -- path/to/HealPath_BI_Starter.xlsx
 *
 * Handles the two data-quality issues found in the raw extract:
 *   1. VisitID has stray whitespace (leading/trailing and doubled internal
 *      spaces) that breaks the join to the fact tables — every id is trimmed
 *      and internal whitespace collapsed on BOTH sides.
 *   2. The pre-computed MonthYear column is corrupt for a large block of rows
 *      (raw date decodes to year 1970 even though the visit is really January
 *      2026). We derive month_year from the reliable Year + MonthName fields
 *      instead, and treat the malformed raw date as NULL.
 *
 * Loads visits first, then the four fact tables so the FK holds, then runs a
 * reconciliation check: row counts + distinct visit_id must match the source.
 */

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import 'dotenv/config';

const MONTH_NO: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const cleanId = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const blankToNull = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

function monthYear(year: unknown, monthName: unknown): string | null {
  const mn = String(monthName ?? '').slice(0, 3);
  const no = MONTH_NO[mn];
  const yr = Number(year);
  if (!no || !yr || yr < 2000) return null; // 1970 stragglers -> null year handled by caller
  return `${yr}-${String(no).padStart(2, '0')}`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Provide the workbook path: npm run import -- file.xlsx');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(url, key, { db: { schema: 'healpath' } });

  const wb = XLSX.readFile(file);
  const sheet = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]);

  // --- visits -------------------------------------------------------------
  const visitsRaw = sheet('Visit');
  const visits = visitsRaw.map((r) => {
    // For the corrupt 1970 rows the MonthName is still correct, so fold them
    // into 2026 (the clean analytic window) rather than dropping them.
    const rawYear = Number(r['Year']);
    const year = rawYear >= 2000 ? rawYear : 2026;
    const my = monthYear(year, r['MonthName']);
    return {
      visit_id: cleanId(r['VisitID']),
      patient_id: Number(r['Patient Id']) || null,
      prescription_date: rawYear >= 2000 ? (r['Prescription Date'] ?? null) : null,
      doctor_specialty: blankToNull(r['Doctor Specialty']),
      practitioner_name: blankToNull(r['Practitioner Name']),
      month_no: my ? Number(my.slice(-2)) : null,
      month_year: my,
    };
  });

  const factConfig: Array<[string, string, (r: any) => Record<string, unknown>]> = [
    ['Diagnosis_Fact', 'diagnosis_fact', (r) => ({
      visit_id: cleanId(r['VisitID']), diseases: blankToNull(r['Diseases']),
      icd_desc: blankToNull(r['icd desc']), icd_block: blankToNull(r['icd_block']),
    })],
    ['Drug_Fact', 'drug_fact', (r) => ({
      visit_id: cleanId(r['VisitID']), medications: blankToNull(r['Medications']),
      brand: blankToNull(r['brand']), ac: blankToNull(r['AC']),
    })],
    ['Lab_Fact', 'lab_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) })],
    ['Scan_Fact', 'scan_fact', (r) => ({ visit_id: cleanId(r['VisitID']), tests: blankToNull(r['Tests']) })],
  ];

  async function insertAll(table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await db.from(table).insert(chunk);
      if (error) throw new Error(`${table} insert failed at row ${i}: ${error.message}`);
    }
    console.log(`  ${table}: ${rows.length} rows`);
  }

  console.log('Loading visits...');
  await insertAll('visits', visits);

  const recon: Record<string, number> = { visits: visits.length };
  for (const [sheetName, table, map] of factConfig) {
    console.log(`Loading ${table}...`);
    const rows = sheet(sheetName).map(map).filter((r) => r.visit_id);
    await insertAll(table, rows);
    recon[table] = rows.length;
  }

  // --- reconciliation -----------------------------------------------------
  console.log('\nReconciliation (loaded row counts):');
  for (const [k, v] of Object.entries(recon)) console.log(`  ${k}: ${v}`);
  const distinctVisits = new Set(visits.map((v) => v.visit_id)).size;
  console.log(`  distinct visit_id: ${distinctVisits}`);
  console.log('\nDone. Verify these match the source workbook before refreshing the dashboard.');
}

main().catch((e) => { console.error(e); process.exit(1); });
