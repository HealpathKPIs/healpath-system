// Shared PDF chrome: page geometry, colors, cover page, header and footer.
// Every exported page — current-page export and Full Report alike — uses these
// same helpers, so margins, header, and footer are identical everywhere.
// Styled for an executive readership: restrained, precise, brand-accented.

import type { jsPDF } from 'jspdf';
import {
  A4_LANDSCAPE_MM,
  EXPORT_BRAND,
  EXPORT_COLORS,
  EXPORT_FOOTER_MM,
  EXPORT_HEADER_MM,
  EXPORT_MARGIN_MM,
} from './constants';
import type { ExportContext, ExportFilterSummary } from './types';

export const PAGE_W = A4_LANDSCAPE_MM.width;
export const PAGE_H = A4_LANDSCAPE_MM.height;
export const CONTENT_X = EXPORT_MARGIN_MM;
export const CONTENT_W = PAGE_W - EXPORT_MARGIN_MM * 2;
export const CONTENT_TOP = EXPORT_MARGIN_MM + EXPORT_HEADER_MM;
export const CONTENT_BOTTOM = PAGE_H - EXPORT_MARGIN_MM - EXPORT_FOOTER_MM;
export const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function setColor(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setTextColor(r, g, b);
}

export function setDraw(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setDrawColor(r, g, b);
}

export function setFill(pdf: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setFillColor(r, g, b);
}

export interface PdfChrome {
  title: string;
  subtitle?: string;
  generatedAt: Date;
  filters: ExportFilterSummary[];
}

function formatGenerated(date: Date) {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** jsPDF built-in fonts are WinAnsi-only: map/strip glyphs they cannot encode. */
export function pdfSafe(text: string): string {
  return text
    .replace(/▲/g, '+').replace(/▼/g, '-').replace(/■/g, '')
    .replace(/→/g, '->').replace(/←/g, '<-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\u0000-\u00FF]/g, '')
    .replace(/\s+/g, ' ').trimEnd();
}

/** Executive header band: brand mark, dashboard title, generated stamp, filters. */
export function drawPdfHeader(pdf: jsPDF, chrome: PdfChrome) {
  const left = EXPORT_MARGIN_MM;
  const right = PAGE_W - EXPORT_MARGIN_MM;

  // Brand mark: small accent square + wordmark.
  setFill(pdf, EXPORT_COLORS.accent);
  pdf.roundedRect(left, EXPORT_MARGIN_MM, 3.4, 3.4, 0.8, 0.8, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11.5);
  setColor(pdf, EXPORT_COLORS.accentInk);
  pdf.text(pdfSafe(EXPORT_BRAND), left + 5.2, EXPORT_MARGIN_MM + 3);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  setColor(pdf, EXPORT_COLORS.soft);
  pdf.text(pdfSafe(`Generated ${formatGenerated(chrome.generatedAt)}`), right, EXPORT_MARGIN_MM + 3, { align: 'right' });

  // Dashboard title with a short accent underline.
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13.5);
  setColor(pdf, EXPORT_COLORS.ink);
  pdf.text(pdfSafe(chrome.title), left, EXPORT_MARGIN_MM + 10);
  if (chrome.subtitle) {
    const safeTitle = pdfSafe(chrome.title);
    const titleWidth = pdf.getTextWidth(safeTitle);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    setColor(pdf, EXPORT_COLORS.muted);
    pdf.text(pdfSafe(chrome.subtitle), left + titleWidth + 3, EXPORT_MARGIN_MM + 10);
  }
  setDraw(pdf, EXPORT_COLORS.accent);
  pdf.setLineWidth(0.7);
  pdf.line(left, EXPORT_MARGIN_MM + 12, left + 14, EXPORT_MARGIN_MM + 12);

  // Applied filters, one quiet line.
  const filterLine = pdfSafe(chrome.filters.map((f) => `${f.label}: ${f.value}`).join('    |    '));
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.2);
  setColor(pdf, EXPORT_COLORS.muted);
  const lines = pdf.splitTextToSize(filterLine, CONTENT_W) as string[];
  pdf.text(lines.slice(0, 1).map(pdfSafe), left, EXPORT_MARGIN_MM + 15.6);

  setDraw(pdf, EXPORT_COLORS.border);
  pdf.setLineWidth(0.2);
  pdf.line(left, CONTENT_TOP - 2, right, CONTENT_TOP - 2);
}

/**
 * Executive footer on every page (page numbers computed at the end).
 * `skipPages` leaves the first N pages (e.g. the cover) footer-free.
 */
export function drawPdfFooters(pdf: jsPDF, options: { skipPages?: number } = {}) {
  const skip = options.skipPages ?? 0;
  const total = pdf.getNumberOfPages();
  for (let page = skip + 1; page <= total; page += 1) {
    pdf.setPage(page);
    setDraw(pdf, EXPORT_COLORS.border);
    pdf.setLineWidth(0.2);
    pdf.line(EXPORT_MARGIN_MM, CONTENT_BOTTOM + 3, PAGE_W - EXPORT_MARGIN_MM, CONTENT_BOTTOM + 3);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    setColor(pdf, EXPORT_COLORS.soft);
    pdf.text(pdfSafe(EXPORT_BRAND), EXPORT_MARGIN_MM, PAGE_H - EXPORT_MARGIN_MM);
    pdf.text(pdfSafe('Confidential - Executive Report'), PAGE_W / 2, PAGE_H - EXPORT_MARGIN_MM, { align: 'center' });
    pdf.text(pdfSafe(`Page ${page - skip} of ${total - skip}`), PAGE_W - EXPORT_MARGIN_MM, PAGE_H - EXPORT_MARGIN_MM, { align: 'right' });
  }
}

/** Full-bleed executive cover page (used by the Full Report). */
export function drawCoverPage(pdf: jsPDF, context: ExportContext, dashboards: string[]) {
  // Deep-ink canvas with a left accent spine.
  setFill(pdf, EXPORT_COLORS.ink);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setFill(pdf, EXPORT_COLORS.accent);
  pdf.rect(0, 0, 3.2, PAGE_H, 'F');

  const left = 26;

  // Brand mark.
  setFill(pdf, EXPORT_COLORS.accent);
  pdf.roundedRect(left, 38, 6.4, 6.4, 1.4, 1.4, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(19);
  pdf.setTextColor(255, 255, 255);
  pdf.text(pdfSafe(EXPORT_BRAND), left + 10, 43.2);

  // Title block.
  pdf.setFontSize(33);
  pdf.text(pdfSafe('Executive Dashboard'), left, 78);
  pdf.text(pdfSafe('Report'), left, 92);
  setDraw(pdf, EXPORT_COLORS.accent);
  pdf.setLineWidth(1);
  pdf.line(left, 100, left + 42, 100);

  // Meta block.
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11.5);
  pdf.setTextColor(203, 209, 222);
  pdf.text(pdfSafe(`Reporting Month    ${context.reportingLabel ?? context.reportingMonth}`), left, 116);
  pdf.text(pdfSafe(`Generated          ${context.generatedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`), left, 124);

  // Applied filters.
  const filterLine = pdfSafe(context.filters.map((f) => `${f.label}: ${f.value}`).join('     '));
  pdf.setFontSize(8.5);
  pdf.setTextColor(148, 163, 184);
  const lines = pdf.splitTextToSize(filterLine, PAGE_W - left - 24) as string[];
  pdf.text(lines.slice(0, 2).map(pdfSafe), left, 138);

  // Contents.
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(129, 140, 248);
  pdf.text(pdfSafe('CONTENTS'), left, 156);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(203, 209, 222);
  dashboards.forEach((name, index) => {
    const column = index < 4 ? 0 : 1;
    const row = index % 4;
    pdf.text(pdfSafe(`${String(index + 1).padStart(2, '0')}   ${name}`), left + column * 92, 164 + row * 7.4);
  });

  // Footer line.
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(pdfSafe('Confidential - Prepared for executive review'), left, PAGE_H - 14);
}

export async function createPdf(): Promise<jsPDF> {
  const { jsPDF: JsPdf } = await import('jspdf');
  return new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
}
