/**
 * scripts/pg-import.mjs — CLI for the HealPath workbook importer.
 *
 * Sprint 26: the parsing/cleaning/loading logic now lives in
 * lib/import-core.mjs (single source of truth), shared verbatim with the
 * Admin → Data Import UI. This file is only the command-line wrapper.
 *
 * Usage: node scripts/pg-import.mjs [path/to/HealPath_BI_Starter.xlsx]
 */
import fs from 'node:fs';
import { parseWorkbook, loadDatabase, validateDatabase, TABLE_ORDER } from '../lib/import-core.mjs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const FILE = process.argv[2] || 'C:/Users/User/Downloads/HealPath_BI_Starter.xlsx';

const parsed = parseWorkbook(FILE);

// Referential-integrity handling: orphan fact rows (no parent visit in the
// extract) are skipped per standing decision — never fabricated — and reported.
const totalOrphans = Object.values(parsed.skips).reduce((a, s) => a + s.orphan, 0);
if (totalOrphans > 0) {
  console.warn(`\nSkipping ${totalOrphans} orphan fact row(s) whose VisitID has no matching visit (proven; skipped per instruction, not fabricated):`);
  for (const [t, s] of Object.entries(parsed.skips)) {
    if (s.orphan) console.warn(`  ${t}: skip ${s.orphan} row(s); example VisitIDs ${JSON.stringify(s.orphanExamples)}`);
  }
}

let lastTable = '';
const result = await loadDatabase(parsed, {
  onProgress: ({ table, total }) => {
    if (table !== lastTable) { console.log(`Loading ${table} (${total})...`); lastTable = table; }
  },
});

const report = await validateDatabase();

console.log('\n================= VALIDATION =================');
console.log('table            db_count   distinct_vid   null_vid   parsed_loaded');
for (const t of TABLE_ORDER) {
  const r = report.tables[t];
  console.log(
    t.padEnd(16),
    String(r.count).padStart(8),
    String(r.distinctVisitId).padStart(13),
    String(r.nullVisitId).padStart(10),
    String(parsed.counts[t]).padStart(14),
  );
}
console.log('\nFK integrity (orphan fact rows referencing a missing visit — must be 0):');
for (const t of TABLE_ORDER.slice(1)) console.log('  ' + t.padEnd(16), report.fk[t]);
console.log('\nSkipped source rows (blank or FK-orphan visit_id):');
for (const [t, s] of Object.entries(parsed.skips)) {
  console.log(`  ${t.padEnd(16)} source=${s.source} loaded=${s.loaded} blank=${s.blank} orphan=${s.orphan}`, s.orphan ? `e.g. ${JSON.stringify(s.orphanExamples)}` : '');
}
console.log(`\nLoad duration: ${(result.loadMs / 1000).toFixed(1)}s`);
console.log('\n<<<REPORT_JSON>>>' + JSON.stringify({ loadMs: result.loadMs, tables: report.tables, fk: report.fk, skips: parsed.skips }) + '<<<END_REPORT_JSON>>>');
