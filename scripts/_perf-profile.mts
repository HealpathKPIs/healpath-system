// READ ONLY — where does the time go inside each slow page's data layer?
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const q = await import('../lib/queries');
const pe = await import('../lib/patient-explorer');

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  try { await fn(); } catch (e) { console.log(`  ${label.padEnd(38)} ERROR ${(e as Error).message.slice(0,60)}`); return; }
  console.log(`  ${label.padEnd(38)} ${String(Date.now() - t0).padStart(7)}ms`);
}

console.log('\nCHRONIC');
await time('getChronicOverview({}) [analytics page]', () => q.getChronicOverview({} as any));
await time('getChronicOverview({}) again', () => q.getChronicOverview({} as any));
await time('getChronicPageData({}) [chronic page]', () => (q as any).getChronicPageData({}));
await time('getChronicPageData({}) again', () => (q as any).getChronicPageData({}));
await time('getChronicCalendar()', () => q.getChronicCalendar());

console.log('\nPATIENT EXPLORER');
await time('getPatientExplorerData({})', () => pe.getPatientExplorerData({} as any));
await time('getPatientExplorerOptions({})', () => pe.getPatientExplorerOptions({}));

console.log('\nACUTE (for comparison)');
const f = { month: null, specialty: null, doctor: null, drug: null, disease: null, riskCarrier: null } as any;
await time('getKpis', () => q.getKpis(f));
await time('getTrends', () => q.getTrends(null, null, null, null, null));
await time('getSpecialties', () => q.getSpecialties(f));
await time('getCascadingFilterOptions({})', () => q.getCascadingFilterOptions({}));
await time('getCascadingFilterOptions({month})', () => q.getCascadingFilterOptions({ month: '2026-07' }));
process.exit(0);
