// Full Executive Report — a DESIGNED, fully vector PDF brief (Sprint 45 final).
// No screenshots: every page is drawn natively with jsPDF from the same live
// query APIs the dashboards use, so numbers always match the screens and the
// layout is identical on every run. Structure: cover → Executive Summary →
// one detailed chapter per acute area. Chronic pages are excluded.

import { EXPORT_COLORS } from './constants';
import { chromeForContext } from './exportPdf';
import { createPdf, drawCoverPage, drawPdfFooters } from './pdfChrome';
import { collectReportData, monthLabel, pctChange, type ExecutiveReportBundle } from './reportData';
import {
  barList,
  bullets,
  ensure,
  formatDelta,
  formatNumber,
  kpiGrid,
  lineChart,
  sectionTitle,
  spacer,
  startChapter,
  table,
  type Flow,
  type KpiItem,
} from './reportLayout';
import type { ExportContext } from './types';

const CHAPTERS = [
  'Executive Summary',
  'Overview',
  'Disease & Diagnosis',
  'Pharmacy',
  'Doctor & Specialty',
  'Labs & Scans',
  'Trends',
  'Monthly Performance',
];

const share = (value: number, total: number) => (total ? `${((value / total) * 100).toFixed(1)}%` : '-');
const sum = (rows: { value: number }[]) => rows.reduce((acc, row) => acc + row.value, 0);

function kpiItems(bundle: ExecutiveReportBundle): KpiItem[] {
  const { current, previous } = bundle.kpis;
  const deltaLabel = bundle.previousWindowLabel ?? 'prev month';
  const item = (label: string, value: number, prev: number | null, decimals = 0, upIsGood = true): KpiItem => ({
    label,
    value: formatNumber(value, decimals),
    deltaPct: pctChange(value, prev),
    deltaLabel,
    upIsGood,
  });
  return [
    item('Visits', current.visits, previous?.visits ?? null),
    item('Patients', current.patients, previous?.patients ?? null),
    item('Doctors', current.doctors, previous?.doctors ?? null),
    item('Specialties', current.specialties, previous?.specialties ?? null),
    item('Avg Meds / Visit', current.avgMeds, previous?.avgMeds ?? null, 2, false),
    item('Avg Labs / Visit', current.avgLabs, previous?.avgLabs ?? null, 2, false),
    item('Avg Scans / Visit', current.avgScans, previous?.avgScans ?? null, 2, false),
  ];
}

function executiveSentences(bundle: ExecutiveReportBundle): string[] {
  const { current, previous } = bundle.kpis;
  const lines: string[] = [];
  const visitsPct = pctChange(current.visits, previous?.visits ?? null);
  if (visitsPct !== null && previous) {
    const verb = visitsPct > 1 ? 'grew' : visitsPct < -1 ? 'contracted' : 'remained stable at';
    lines.push(`Visit volume ${verb} ${visitsPct > 1 || visitsPct < -1 ? `${Math.abs(visitsPct).toFixed(1)}% ` : ''}(${formatNumber(previous.visits)} to ${formatNumber(current.visits)}) versus ${bundle.previousWindowLabel ?? bundle.previousLabel}.`);
  } else {
    lines.push(`Visit volume for ${bundle.reportingLabel}: ${formatNumber(current.visits)} visits across ${formatNumber(current.patients)} patients.`);
  }
  const medsPct = pctChange(current.avgMeds, previous?.avgMeds ?? null);
  if (medsPct !== null) {
    const direction = medsPct > 1 ? 'increased' : medsPct < -1 ? 'decreased' : 'remained stable';
    lines.push(`Medication load per visit ${direction}${Math.abs(medsPct) > 1 ? ` ${Math.abs(medsPct).toFixed(1)}%` : ''} (${current.avgMeds.toFixed(2)} medications per visit).`);
  }
  if (bundle.diseases.blocks[0]) lines.push(`${bundle.diseases.blocks[0].label} is the leading diagnosis group with ${formatNumber(bundle.diseases.blocks[0].value)} cases.`);
  if (bundle.drugs.ac[0]) lines.push(`${bundle.drugs.ac[0].label} remains the most prescribed active ingredient (${formatNumber(bundle.drugs.ac[0].value)} prescriptions).`);
  if (bundle.diagnostics.labs[0]) lines.push(`${bundle.diagnostics.labs[0].label} is the leading laboratory investigation (${formatNumber(bundle.diagnostics.labs[0].value)} requests).`);
  if (bundle.specialties.ranking[0]) lines.push(`${bundle.specialties.ranking[0].label} is the busiest specialty (${formatNumber(bundle.specialties.ranking[0].value)} visits).`);
  const topDoctor = bundle.specialties.doctors[0];
  if (topDoctor) lines.push(`${topDoctor.practitioner} leads doctor activity with ${formatNumber(topDoctor.visits)} visits (${topDoctor.medsPerVisit.toFixed(2)} meds per visit).`);
  return lines;
}

function chapterExecutiveSummary(flow: Flow, bundle: ExecutiveReportBundle) {
  sectionTitle(flow, `Reporting Month: ${bundle.reportingLabel}${bundle.previousWindowLabel ? `   |   compared with ${bundle.previousWindowLabel}` : ''}`);
  kpiGrid(flow, kpiItems(bundle), 4);
  spacer(flow, 2);
  sectionTitle(flow, 'Key Movements');
  bullets(flow, executiveSentences(bundle));
  const visitPoints = bundle.trends.points.filter((point) => typeof point.visits === 'number');
  if (visitPoints.length >= 2) {
    spacer(flow, 2);
    sectionTitle(flow, 'Visit Volume by Month');
    lineChart(
      flow,
      visitPoints.map((point) => monthLabel(point.month)),
      [{ label: 'Visits', color: EXPORT_COLORS.accent, values: visitPoints.map((point) => point.visits as number) }],
      48,
      0,
    );
  }
}

function chapterOverview(flow: Flow, bundle: ExecutiveReportBundle) {
  const { current, previous } = bundle.kpis;
  sectionTitle(flow, `Key Indicators - ${bundle.reportingLabel}${bundle.previousWindowLabel ? ` vs ${bundle.previousWindowLabel}` : ''}`);
  const metric = (label: string, cur: number, prev: number | null | undefined, decimals = 0) => [
    label,
    formatNumber(cur, decimals),
    prev === null || prev === undefined ? '-' : formatNumber(prev, decimals),
    formatDelta(pctChange(cur, prev ?? null)),
  ];
  table(flow, [
    { header: 'Indicator', width: 97 },
    { header: bundle.reportingLabel, width: 60, align: 'right' },
    { header: bundle.previousWindowLabel ?? 'Previous', width: 60, align: 'right' },
    { header: 'Change', width: 60, align: 'right' },
  ], [
    metric('Visits', current.visits, previous?.visits),
    metric('Patients', current.patients, previous?.patients),
    metric('Active Doctors', current.doctors, previous?.doctors),
    metric('Active Specialties', current.specialties, previous?.specialties),
    metric('Avg Medications / Visit', current.avgMeds, previous?.avgMeds, 2),
    metric('Avg Laboratories / Visit', current.avgLabs, previous?.avgLabs, 2),
    metric('Avg Scans / Visit', current.avgScans, previous?.avgScans, 2),
  ]);
  spacer(flow, 2);
  sectionTitle(flow, 'Top Disease Blocks');
  barList(flow, bundle.diseases.blocks, EXPORT_COLORS.accent, 5);
  spacer(flow, 2);
  sectionTitle(flow, 'Top Active Ingredients');
  barList(flow, bundle.drugs.ac, EXPORT_COLORS.labs, 5);
}

function chapterDiseases(flow: Flow, bundle: ExecutiveReportBundle) {
  sectionTitle(flow, 'Diagnoses by ICD Block');
  barList(flow, bundle.diseases.blocks, EXPORT_COLORS.accent, 10);
  spacer(flow, 2);
  sectionTitle(flow, 'Leading Diagnoses');
  const total = sum(bundle.diseases.descriptions);
  table(flow, [
    { header: '#', width: 12, align: 'right' },
    { header: 'Diagnosis', width: 185 },
    { header: 'Cases', width: 40, align: 'right' },
    { header: 'Share', width: 40, align: 'right' },
  ], bundle.diseases.descriptions.slice(0, 15).map((row, index) => [
    String(index + 1),
    row.label,
    formatNumber(row.value),
    share(row.value, total),
  ]));
}

function chapterPharmacy(flow: Flow, bundle: ExecutiveReportBundle) {
  const { current, previous } = bundle.kpis;
  kpiGrid(flow, [
    { label: 'Avg Meds / Visit', value: formatNumber(current.avgMeds, 2), deltaPct: pctChange(current.avgMeds, previous?.avgMeds ?? null), upIsGood: false },
    { label: 'Total Visits', value: formatNumber(current.visits), deltaPct: pctChange(current.visits, previous?.visits ?? null) },
    { label: `Top Ingredient - ${bundle.drugs.ac[0]?.label ?? '-'}`, value: formatNumber(bundle.drugs.ac[0]?.value ?? 0), deltaPct: null },
    { label: `Top Brand - ${bundle.drugs.brands[0]?.label ?? '-'}`, value: formatNumber(bundle.drugs.brands[0]?.value ?? 0), deltaPct: null },
  ], 4);
  spacer(flow, 2);
  sectionTitle(flow, 'Active Ingredients');
  const ingredientTotal = sum(bundle.drugs.ac);
  table(flow, [
    { header: '#', width: 12, align: 'right' },
    { header: 'Active Ingredient', width: 165 },
    { header: 'Prescriptions', width: 55, align: 'right' },
    { header: 'Share', width: 45, align: 'right' },
  ], bundle.drugs.ac.slice(0, 15).map((row, index) => [
    String(index + 1),
    row.label,
    formatNumber(row.value),
    share(row.value, ingredientTotal),
  ]));
  spacer(flow, 2);
  sectionTitle(flow, 'Brands');
  const brandTotal = sum(bundle.drugs.brands);
  table(flow, [
    { header: '#', width: 12, align: 'right' },
    { header: 'Brand', width: 165 },
    { header: 'Prescriptions', width: 55, align: 'right' },
    { header: 'Share', width: 45, align: 'right' },
  ], bundle.drugs.brands.slice(0, 10).map((row, index) => [
    String(index + 1),
    row.label,
    formatNumber(row.value),
    share(row.value, brandTotal),
  ]));
}

function chapterDoctors(flow: Flow, bundle: ExecutiveReportBundle) {
  sectionTitle(flow, 'Visits by Specialty');
  barList(flow, bundle.specialties.ranking, EXPORT_COLORS.accent, 10);
  spacer(flow, 2);
  sectionTitle(flow, 'Doctor Activity Matrix');
  table(flow, [
    { header: '#', width: 10, align: 'right' },
    { header: 'Doctor', width: 78 },
    { header: 'Specialty', width: 87 },
    { header: 'Visits', width: 34, align: 'right' },
    { header: 'Meds / Visit', width: 34, align: 'right' },
    { header: 'Labs / Visit', width: 34, align: 'right' },
  ], bundle.specialties.doctors.slice(0, 20).map((row, index) => [
    String(index + 1),
    row.practitioner,
    row.specialty || '-',
    formatNumber(row.visits),
    row.medsPerVisit.toFixed(2),
    row.labsPerVisit.toFixed(2),
  ]));
}

function chapterDiagnostics(flow: Flow, bundle: ExecutiveReportBundle) {
  kpiGrid(flow, [
    { label: 'Avg Labs / Visit', value: formatNumber(bundle.diagnostics.avgLabs, 2), deltaPct: pctChange(bundle.diagnostics.avgLabs, bundle.kpis.previous?.avgLabs ?? null), upIsGood: false },
    { label: 'Avg Scans / Visit', value: formatNumber(bundle.diagnostics.avgScans, 2), deltaPct: pctChange(bundle.diagnostics.avgScans, bundle.kpis.previous?.avgScans ?? null), upIsGood: false },
    { label: `Top Laboratory - ${bundle.diagnostics.labs[0]?.label ?? '-'}`, value: formatNumber(bundle.diagnostics.labs[0]?.value ?? 0), deltaPct: null },
    { label: `Top Scan - ${bundle.diagnostics.scans[0]?.label ?? '-'}`, value: formatNumber(bundle.diagnostics.scans[0]?.value ?? 0), deltaPct: null },
  ], 4);
  spacer(flow, 2);
  sectionTitle(flow, 'Laboratory Investigations');
  const labTotal = sum(bundle.diagnostics.labs);
  table(flow, [
    { header: '#', width: 12, align: 'right' },
    { header: 'Laboratory Test', width: 165 },
    { header: 'Requests', width: 55, align: 'right' },
    { header: 'Share', width: 45, align: 'right' },
  ], bundle.diagnostics.labs.slice(0, 10).map((row, index) => [
    String(index + 1),
    row.label,
    formatNumber(row.value),
    share(row.value, labTotal),
  ]));
  spacer(flow, 2);
  sectionTitle(flow, 'Imaging & Scans');
  const scanTotal = sum(bundle.diagnostics.scans);
  table(flow, [
    { header: '#', width: 12, align: 'right' },
    { header: 'Scan', width: 165 },
    { header: 'Requests', width: 55, align: 'right' },
    { header: 'Share', width: 45, align: 'right' },
  ], bundle.diagnostics.scans.slice(0, 10).map((row, index) => [
    String(index + 1),
    row.label,
    formatNumber(row.value),
    share(row.value, scanTotal),
  ]));
}

function chapterTrends(flow: Flow, bundle: ExecutiveReportBundle) {
  sectionTitle(flow, 'Utilization per Visit by Month');
  const points = bundle.trends.points;
  if (points.length >= 2) {
    lineChart(flow, points.map((point) => monthLabel(point.month)), [
      { label: 'Avg Meds / Visit', color: EXPORT_COLORS.meds, values: points.map((point) => point.meds) },
      { label: 'Avg Labs / Visit', color: EXPORT_COLORS.labs, values: points.map((point) => point.labs) },
      { label: 'Avg Scans / Visit', color: EXPORT_COLORS.scans, values: points.map((point) => point.scans) },
    ], 56, 2);
  }
  spacer(flow, 2);
  sectionTitle(flow, 'Monthly Detail');
  table(flow, [
    { header: 'Month', width: 61 },
    { header: 'Visits', width: 54, align: 'right' },
    { header: 'Meds / Visit', width: 54, align: 'right' },
    { header: 'Labs / Visit', width: 54, align: 'right' },
    { header: 'Scans / Visit', width: 54, align: 'right' },
  ], points.map((point) => [
    monthLabel(point.month),
    point.visits === undefined ? '-' : formatNumber(point.visits),
    point.meds.toFixed(2),
    point.labs.toFixed(2),
    point.scans.toFixed(2),
  ]));
  const delta = bundle.trends.delta;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  bullets(flow, [
    `Latest month-over-month movement (average per visit): medications ${signed(delta.meds)}, laboratories ${signed(delta.labs)}, scans ${signed(delta.scans)}.`,
  ]);
}

function chapterPerformance(flow: Flow, bundle: ExecutiveReportBundle) {
  const points = bundle.trends.points;
  const visitValues = points.map((point) => point.visits ?? 0);
  const bestIndex = visitValues.indexOf(Math.max(...visitValues));
  sectionTitle(flow, 'Monthly Performance Matrix');
  table(flow, [
    { header: 'Month', width: 61 },
    { header: 'Visits', width: 54, align: 'right' },
    { header: 'Meds / Visit', width: 54, align: 'right' },
    { header: 'Labs / Visit', width: 54, align: 'right' },
    { header: 'Scans / Visit', width: 54, align: 'right' },
  ], points.map((point) => [
    monthLabel(point.month),
    point.visits === undefined ? '-' : formatNumber(point.visits),
    point.meds.toFixed(2),
    point.labs.toFixed(2),
    point.scans.toFixed(2),
  ]), { highlightRow: bestIndex >= 0 ? bestIndex : undefined });
  spacer(flow, 2);
  const busiest = bestIndex >= 0 ? points[bestIndex] : null;
  const highestMeds = [...points].sort((a, b) => b.meds - a.meds)[0];
  const lines: string[] = [];
  if (busiest?.visits) lines.push(`Busiest month: ${monthLabel(busiest.month)} with ${formatNumber(busiest.visits)} visits.`);
  if (highestMeds) lines.push(`Highest medication load: ${monthLabel(highestMeds.month)} at ${highestMeds.meds.toFixed(2)} medications per visit.`);
  if (bundle.specialties.doctors[0]) {
    const top = bundle.specialties.doctors[0];
    lines.push(`Leading practitioner in ${bundle.reportingLabel}: ${top.practitioner} (${formatNumber(top.visits)} visits, ${top.medsPerVisit.toFixed(2)} meds per visit).`);
  }
  ensure(flow, 8);
  sectionTitle(flow, 'Highlights');
  bullets(flow, lines);
}

export interface FullReportOptions {
  context: ExportContext;
  /** URL search string (e.g. "?month=2026-03") — the report inherits filters. */
  search: string;
  onProgress?: (detail: string) => void;
}

export async function exportFullReport(options: FullReportOptions): Promise<void> {
  const { context, search, onProgress } = options;

  const bundle = await collectReportData(search, onProgress);
  const pdf = await createPdf();

  drawCoverPage(pdf, { ...context, reportingLabel: bundle.reportingLabel, reportingMonth: bundle.reportingMonth || context.reportingMonth }, CHAPTERS);

  const chapters: Array<{ name: string; render: (flow: Flow) => void }> = [
    { name: 'Executive Summary', render: (flow) => chapterExecutiveSummary(flow, bundle) },
    { name: 'Overview', render: (flow) => chapterOverview(flow, bundle) },
    { name: 'Disease & Diagnosis', render: (flow) => chapterDiseases(flow, bundle) },
    { name: 'Pharmacy', render: (flow) => chapterPharmacy(flow, bundle) },
    { name: 'Doctor & Specialty', render: (flow) => chapterDoctors(flow, bundle) },
    { name: 'Labs & Scans', render: (flow) => chapterDiagnostics(flow, bundle) },
    { name: 'Trends', render: (flow) => chapterTrends(flow, bundle) },
    { name: 'Monthly Performance', render: (flow) => chapterPerformance(flow, bundle) },
  ];

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    onProgress?.(`Composing ${chapter.name} (${index + 1}/${chapters.length})`);
    const flow = startChapter(pdf, chromeForContext(context, chapter.name));
    chapter.render(flow);
  }

  drawPdfFooters(pdf, { skipPages: 1 });
  onProgress?.('Downloading');
  pdf.save(`healpath-executive-report-${bundle.reportingMonth || context.reportingMonth}.pdf`);
}
