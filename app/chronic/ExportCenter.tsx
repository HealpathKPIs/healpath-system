'use client';

import type { ChronicKpiDrillStep, ChronicPageData } from '@/lib/queries';
import { useMemo, useState } from 'react';

type ExportValue = string | number;
type ExportRow = Record<string, ExportValue>;
type ExportSection = { title: string; rows: ExportRow[] };

interface ExportCenterProps {
  data: ChronicPageData;
}

const buttonStyle: React.CSSProperties = {
  height: 36,
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  padding: '0 12px',
  fontWeight: 850,
  cursor: 'pointer',
};

function csvEscape(value: ExportValue) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlEscape(value: ExportValue) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chronic-export';
}

function downloadBlob(name: string, type: string, content: BlobPart) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: ExportRow[]) {
  if (!rows.length) return 'No data\n';
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')),
  ].join('\n');
}

function sectionToHtml(section: ExportSection) {
  const headers = section.rows.length ? Array.from(section.rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>())) : ['Status'];
  const rows = section.rows.length ? section.rows : [{ Status: 'No data' }];
  return `
    <h2>${htmlEscape(section.title)}</h2>
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header] ?? '')}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function filterRows(data: ChronicPageData): ExportRow[] {
  return [
    { Filter: 'Period', Value: data.filters.period || 'All' },
    { Filter: 'Consultant', Value: data.filters.consultant || 'All' },
    { Filter: 'Issue', Value: data.filters.issue || 'All' },
    { Filter: 'Recommendation', Value: data.filters.recommendation || 'All' },
    { Filter: 'Patient Search', Value: data.filters.patient || 'All' },
    { Filter: 'Current Period', Value: data.currentPeriod || 'All' },
  ];
}

function dashboardRows(data: ChronicPageData): ExportRow[] {
  return [
    ...data.prePost.metrics.map((metric) => ({
      Metric: metric.label,
      PRE: metric.pre,
      POST: metric.post,
      Difference: metric.difference,
      'Improvement %': metric.improvementPct,
    })),
    { Metric: 'Waiting Lab', PRE: '', POST: data.prePost.operational.waitingLab, Difference: '', 'Improvement %': '' },
    { Metric: 'No Need For Chronic', PRE: '', POST: data.prePost.operational.noNeedForChronic, Difference: '', 'Improvement %': '' },
    { Metric: 'No Need %', PRE: '', POST: data.prePost.operational.noNeedPct, Difference: '', 'Improvement %': '' },
  ];
}

function chartRows(data: ChronicPageData): ExportRow[] {
  return data.prePost.outcomeTrends.map((point) => ({
    Period: point.period,
    'PRE Issues / Patient': point.preIssuesPerPatient,
    'POST Issues / Patient': point.postIssuesPerPatient,
    'Issue Improvement %': point.issueImprovementPct,
    'PRE Recommendations / Patient': point.preRecommendationsPerPatient,
    'POST Recommendations / Patient': point.postRecommendationsPerPatient,
    'Recommendation Improvement %': point.recommendationImprovementPct,
  }));
}

function tableRows(data: ChronicPageData): ExportRow[] {
  const issueRows = data.prePost.issueCatalog.map((row) => ({
    Table: 'Issue Catalog',
    Category: row.label,
    'PRE Count': row.pre,
    'POST Count': row.post,
    Difference: row.difference,
    'Improvement %': row.improvementPct,
  }));
  const recommendationRows = data.prePost.recommendationCatalog.map((row) => ({
    Table: 'Recommendation Catalog',
    Category: row.label,
    'PRE Count': row.pre,
    'POST Count': row.post,
    Difference: row.difference,
    'Improvement %': row.improvementPct,
  }));
  return [...issueRows, ...recommendationRows];
}

function rankingRows(data: ChronicPageData): ExportRow[] {
  return Object.entries(data.drilldowns).flatMap(([kpi, steps]) =>
    (steps as ChronicKpiDrillStep[]).flatMap((step) =>
      step.rows.map((row, index) => ({
        KPI: kpi,
        Drilldown: step.title,
        Rank: index + 1,
        Label: row.label,
        Value: row.value,
      })),
    ),
  );
}

function buildSections(data: ChronicPageData): ExportSection[] {
  return [
    { title: 'Filters', rows: filterRows(data) },
    { title: 'Dashboard', rows: dashboardRows(data) },
    { title: 'Charts', rows: chartRows(data) },
    { title: 'Rankings', rows: rankingRows(data) },
    { title: 'Tables', rows: tableRows(data) },
  ];
}

function exportName(data: ChronicPageData, ext: string) {
  return `${slug(`chronic ${data.currentPeriod || data.filters.period || 'all'}`)}.${ext}`;
}

function downloadCsv(data: ChronicPageData) {
  const content = buildSections(data)
    .map((section) => `# ${section.title}\n${rowsToCsv(section.rows)}`)
    .join('\n\n');
  downloadBlob(exportName(data, 'csv'), 'text/csv;charset=utf-8', content);
}

function downloadExcel(data: ChronicPageData) {
  const html = `
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
        <h1>HealPath Chronic Export</h1>
        ${buildSections(data).map(sectionToHtml).join('')}
      </body>
    </html>
  `;
  downloadBlob(exportName(data, 'xls'), 'application/vnd.ms-excel;charset=utf-8', html);
}

function openPdf(data: ChronicPageData) {
  const html = `
    <html>
      <head>
        <title>HealPath Chronic Export</title>
        <style>
          @page { size: A4 landscape; margin: 14mm; }
          body { font-family: Arial, sans-serif; color: #111827; }
          h1 { font-size: 22px; margin: 0 0 10px; }
          h2 { font-size: 14px; margin: 18px 0 8px; page-break-after: avoid; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 12px; page-break-inside: avoid; }
          th, td { border: 1px solid #d7dbe3; padding: 5px 7px; font-size: 10px; }
          th { background: #f1f4f9; text-align: left; }
          td { vertical-align: top; }
        </style>
      </head>
      <body>
        <h1>HealPath Chronic Export</h1>
        ${buildSections(data).map(sectionToHtml).join('')}
        <script>window.onload = function () { window.print(); };</script>
      </body>
    </html>
  `;
  const opened = window.open('', '_blank');
  if (!opened) return;
  opened.document.open();
  opened.document.write(html);
  opened.document.close();
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  let value = text;
  while (ctx.measureText(value).width > maxWidth && value.length > 3) {
    value = `${value.slice(0, -4)}...`;
  }
  ctx.fillText(value, x, y);
}

function downloadPng(data: ChronicPageData) {
  const width = 1500;
  const height = 1900;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#060c18';
  ctx.font = '800 38px Arial';
  ctx.fillText('HealPath Chronic Export', 54, 70);
  ctx.font = '700 18px Arial';
  ctx.fillStyle = '#64748b';
  ctx.fillText(`Filters: ${filterRows(data).map((row) => `${row.Filter}: ${row.Value}`).join(' | ')}`, 54, 106);

  let y = 160;
  ctx.font = '800 22px Arial';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Dashboard', 54, y);
  y += 24;
  data.prePost.metrics.slice(0, 7).forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 54 + col * 690;
    const top = y + row * 112;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, top, 650, 86);
    ctx.strokeStyle = '#e7e9ee';
    ctx.strokeRect(x, top, 650, 86);
    ctx.fillStyle = '#64748b';
    ctx.font = '800 16px Arial';
    drawText(ctx, metric.label, x + 18, top + 27, 290);
    ctx.fillStyle = '#060c18';
    ctx.font = '800 23px Arial';
    ctx.fillText(`PRE ${metric.pre.toLocaleString()}   POST ${metric.post.toLocaleString()}`, x + 18, top + 58);
    ctx.fillStyle = metric.improvementPct >= 0 ? '#059669' : '#e11d48';
    ctx.font = '800 18px Arial';
    ctx.fillText(`${metric.improvementPct.toFixed(1)}%`, x + 540, top + 57);
  });

  y += 470;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 22px Arial';
  ctx.fillText('Charts', 54, y);
  y += 32;
  const chartX = 54;
  const chartY = y;
  const chartW = 1360;
  const chartH = 300;
  ctx.strokeStyle = '#e7e9ee';
  ctx.strokeRect(chartX, chartY, chartW, chartH);
  const points = data.prePost.outcomeTrends;
  const chartValues = points.flatMap((point) => [
    point.preIssuesPerPatient,
    point.postIssuesPerPatient,
    point.preRecommendationsPerPatient,
    point.postRecommendationsPerPatient,
  ]);
  const max = Math.max(...chartValues, 1);
  const plot = (
    key: 'preIssuesPerPatient' | 'postIssuesPerPatient' | 'preRecommendationsPerPatient' | 'postRecommendationsPerPatient',
    color: string,
  ) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const px = chartX + 45 + index * ((chartW - 90) / Math.max(points.length - 1, 1));
      const py = chartY + 30 + (1 - point[key] / max) * (chartH - 70);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
  };
  plot('preIssuesPerPatient', '#d97706');
  plot('postIssuesPerPatient', '#6366f1');
  plot('preRecommendationsPerPatient', '#0d9488');
  plot('postRecommendationsPerPatient', '#2563eb');
  ctx.font = '800 16px Arial';
  ctx.fillStyle = '#d97706';
  ctx.fillText('PRE Issues / Patient', chartX + 30, chartY + chartH - 22);
  ctx.fillStyle = '#6366f1';
  ctx.fillText('POST Issues / Patient', chartX + 230, chartY + chartH - 22);
  ctx.fillStyle = '#0d9488';
  ctx.fillText('PRE Recs / Patient', chartX + 465, chartY + chartH - 22);
  ctx.fillStyle = '#2563eb';
  ctx.fillText('POST Recs / Patient', chartX + 655, chartY + chartH - 22);

  y += 355;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 22px Arial';
  ctx.fillText('Rankings', 54, y);
  y += 30;
  const ranking = [
    ...(data.drilldowns.Issues?.find((step) => step.title === 'Top Categories')?.rows ?? []).slice(0, 5),
    ...(data.drilldowns.Recommendations?.find((step) => step.title === 'Top Categories')?.rows ?? []).slice(0, 5),
  ];
  const rankMax = Math.max(...ranking.map((row) => row.value), 1);
  ranking.forEach((row, index) => {
    const barY = y + index * 42;
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 15px Arial';
    drawText(ctx, row.label, 54, barY + 17, 390);
    ctx.fillStyle = '#f1f4f9';
    ctx.fillRect(470, barY, 760, 20);
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(470, barY, Math.max(4, (row.value / rankMax) * 760), 20);
    ctx.fillStyle = '#64748b';
    ctx.fillText(row.value.toLocaleString(), 1250, barY + 17);
  });

  y += 460;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 22px Arial';
  ctx.fillText('Tables', 54, y);
  y += 34;
  const tablePreview = tableRows(data).slice(0, 14);
  ctx.font = '800 15px Arial';
  tablePreview.forEach((row, index) => {
    const rowY = y + index * 34;
    ctx.fillStyle = index % 2 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(54, rowY - 18, 1360, 28);
    ctx.fillStyle = '#0f172a';
    drawText(ctx, String(row.Category), 70, rowY, 520);
    ctx.fillStyle = '#64748b';
    ctx.fillText(String(row.Table), 650, rowY);
    ctx.fillText(`PRE ${row['PRE Count']}  POST ${row['POST Count']}`, 990, rowY);
    ctx.fillText(`${Number(row['Improvement %']).toFixed(1)}%`, 1260, rowY);
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportName(data, 'png');
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export default function ExportCenter({ data }: ExportCenterProps) {
  const [status, setStatus] = useState('');
  const sections = useMemo(() => buildSections(data), [data]);
  const totals = useMemo(() => ({
    dashboard: sections.find((section) => section.title === 'Dashboard')?.rows.length ?? 0,
    charts: sections.find((section) => section.title === 'Charts')?.rows.length ?? 0,
    rankings: sections.find((section) => section.title === 'Rankings')?.rows.length ?? 0,
    tables: sections.find((section) => section.title === 'Tables')?.rows.length ?? 0,
  }), [sections]);

  const onExport = (kind: 'Excel' | 'CSV' | 'PDF' | 'PNG') => {
    if (kind === 'Excel') downloadExcel(data);
    if (kind === 'CSV') downloadCsv(data);
    if (kind === 'PDF') openPdf(data);
    if (kind === 'PNG') downloadPng(data);
    setStatus(`${kind} export prepared for the current filters.`);
  };

  return (
    <section
      className="card chronic-export-card"
      data-export-center
      tabIndex={-1}
      aria-labelledby="chronic-export-title"
      style={{ display: 'grid', gap: 14 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <p id="chronic-export-title" className="section-title">Export Center</p>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Filtered export package for dashboard, charts, rankings, and tables.
          </p>
        </div>
        <div className="chronic-export-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Export actions">
          <button type="button" onClick={() => onExport('Excel')} style={buttonStyle} aria-label="Export chronic dashboard to Excel">Excel</button>
          <button type="button" onClick={() => onExport('CSV')} style={buttonStyle} aria-label="Export chronic dashboard to CSV">CSV</button>
          <button type="button" onClick={() => onExport('PDF')} style={buttonStyle} aria-label="Export chronic dashboard to PDF">PDF</button>
          <button type="button" onClick={() => onExport('PNG')} style={buttonStyle} aria-label="Export chronic dashboard to PNG">PNG</button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {sections.slice(1).map((section) => (
          <div key={section.title} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--surface-2)', padding: '10px 12px' }}>
            <div className="muted" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>{section.title}</div>
            <b style={{ display: 'block', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>
              {section.title === 'Dashboard' ? totals.dashboard : section.title === 'Charts' ? totals.charts : section.title === 'Rankings' ? totals.rankings : totals.tables} rows
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}
