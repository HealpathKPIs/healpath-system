import { NextRequest, NextResponse } from 'next/server';
import {
  getPatientExplorerData,
  getPatientExplorerExportRows,
  patientExplorerExportFields,
  type PatientExplorerFilters,
} from '@/lib/patient-explorer';

type ExportValue = string | number | null;
type ExportRow = Record<string, ExportValue>;

function csvEscape(value: ExportValue) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: ExportRow[]) {
  if (!rows.length) return 'No data\n';
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

function htmlEscape(value: ExportValue) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionToHtml(title: string, rows: ExportRow[]) {
  const headers = rows.length ? Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>())) : ['Status'];
  const bodyRows = rows.length ? rows : [{ Status: 'No data' }];
  return `
    <h2>${htmlEscape(title)}</h2>
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${bodyRows.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header])}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function excelDocument(title: string, sections: Array<{ title: string; rows: ExportRow[] }>) {
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111827; }
          h1 { font-size: 22px; margin: 0 0 10px; }
          h2 { font-size: 15px; margin: 22px 0 8px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
          th, td { border: 1px solid #d7dbe3; padding: 6px 8px; font-size: 12px; }
          th { background: #f1f4f9; text-align: left; }
        </style>
      </head>
      <body>
        <h1>${htmlEscape(title)}</h1>
        ${sections.map((section) => sectionToHtml(section.title, section.rows)).join('')}
      </body>
    </html>
  `;
}

function parseFilters(req: NextRequest): PatientExplorerFilters {
  const p = req.nextUrl.searchParams;
  const sel = p.get('sel');
  const selv = p.get('selv');
  return {
    month: p.get('month'),
    specialty: p.get('specialty'),
    doctor: p.get('doctor'),
    riskCarrier: p.get('riskCarrier'),
    consultant: p.get('consultant'),
    disease: p.get('disease') ?? (sel === 'disease' ? selv : null),
    medication: p.get('medication'),
    activeIngredient: p.get('activeIngredient') ?? (sel === 'drug' ? selv : null),
    q: p.get('q'),
    sort: p.get('sort'),
    dir: p.get('dir'),
  };
}

function response(content: string, type: string, filename: string) {
  return new NextResponse(content, {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const filters = parseFilters(req);
  const format = p.get('format') === 'excel' ? 'excel' : 'csv';
  const type = p.get('type') === 'summary' ? 'summary' : 'list';

  if (type === 'summary') {
    const data = await getPatientExplorerData(filters);
    const filtersRows = data.stats.currentFilters.map((filter) => ({ Filter: filter.label, Value: filter.value }));
    const kpiRows = [
      { Metric: 'Total Patients', Value: data.kpis.totalPatients },
      { Metric: 'Acute Patients', Value: data.kpis.acutePatients },
      { Metric: 'Chronic Patients', Value: data.kpis.chronicPatients },
      { Metric: 'Patients In Both Programs', Value: data.kpis.bothPatients },
      { Metric: 'Acute Visits', Value: data.kpis.acuteVisits },
      { Metric: 'Chronic Reviews', Value: data.kpis.chronicReviews },
    ];
    const ranked = (section: string, rows: { label: string; value: number }[]) =>
      rows.map((row, index) => ({ Section: section, Rank: index + 1, Label: row.label, Value: row.value }));
    const rankingRows = [
      ...ranked('Top Diseases', data.distributions.diseases),
      ...ranked('Top Medications', data.distributions.medications),
      ...ranked('Top Doctors', data.distributions.doctors),
      ...ranked('Top Consultants', data.distributions.consultants),
    ];
    const sections = [
      { title: 'Selected Filters', rows: filtersRows },
      { title: 'Executive KPIs', rows: kpiRows },
      { title: 'Rankings', rows: rankingRows },
    ];
    if (format === 'excel') {
      return response(excelDocument('HealPath Patient Explorer Executive Summary', sections), 'application/vnd.ms-excel;charset=utf-8', 'patient-explorer-summary.xls');
    }
    return response(sections.map((section) => `# ${section.title}\n${rowsToCsv(section.rows)}`).join('\n\n'), 'text/csv;charset=utf-8', 'patient-explorer-summary.csv');
  }

  const rows = (await getPatientExplorerExportRows(filters)).map(patientExplorerExportFields);
  if (format === 'excel') {
    return response(excelDocument('HealPath Patient Explorer', [{ title: 'Patients', rows }]), 'application/vnd.ms-excel;charset=utf-8', 'patient-explorer.xls');
  }
  return response(rowsToCsv(rows), 'text/csv;charset=utf-8', 'patient-explorer.csv');
}
