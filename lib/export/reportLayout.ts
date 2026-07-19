// Vector layout primitives for the Executive Report. Everything is drawn with
// jsPDF: crisp vector text, tables, KPI blocks, bar lists, and line charts.

import type { jsPDF } from 'jspdf';
import { EXPORT_COLORS } from './constants';
import {
  CONTENT_BOTTOM,
  CONTENT_TOP,
  CONTENT_W,
  CONTENT_X,
  drawPdfHeader,
  pdfSafe,
  setColor,
  setDraw,
  setFill,
  type PdfChrome,
} from './pdfChrome';

export interface Flow {
  pdf: jsPDF;
  chrome: PdfChrome;
  y: number;
}

export function startChapter(pdf: jsPDF, chrome: PdfChrome): Flow {
  pdf.addPage();
  drawPdfHeader(pdf, chrome);
  return { pdf, chrome, y: CONTENT_TOP + 2 };
}

export function ensure(flow: Flow, neededMm: number) {
  if (flow.y + neededMm <= CONTENT_BOTTOM) return;
  flow.pdf.addPage();
  drawPdfHeader(flow.pdf, flow.chrome);
  flow.y = CONTENT_TOP + 2;
}

export function spacer(flow: Flow, mm: number) {
  flow.y += mm;
}

export function sectionTitle(flow: Flow, text: string) {
  ensure(flow, 12);
  setFill(flow.pdf, EXPORT_COLORS.accent);
  flow.pdf.roundedRect(CONTENT_X, flow.y, 1.6, 5, 0.8, 0.8, 'F');
  flow.pdf.setFont('helvetica', 'bold');
  flow.pdf.setFontSize(11);
  setColor(flow.pdf, EXPORT_COLORS.ink);
  flow.pdf.text(pdfSafe(text), CONTENT_X + 4, flow.y + 4);
  flow.y += 9;
}

export function bullets(flow: Flow, lines: string[]) {
  flow.pdf.setFont('helvetica', 'normal');
  flow.pdf.setFontSize(9.2);
  for (const line of lines) {
    const wrapped = flow.pdf.splitTextToSize(pdfSafe(line), CONTENT_W - 8) as string[];
    ensure(flow, wrapped.length * 4.6 + 2);
    setFill(flow.pdf, EXPORT_COLORS.accent);
    flow.pdf.circle(CONTENT_X + 1.4, flow.y + 1.6, 0.9, 'F');
    setColor(flow.pdf, EXPORT_COLORS.text);
    flow.pdf.text(wrapped.map(pdfSafe), CONTENT_X + 5, flow.y + 2.6);
    flow.y += wrapped.length * 4.6 + 1.6;
  }
}

export const formatNumber = (value: number, decimals = 0) =>
  value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const formatDelta = (pct: number | null) =>
  pct === null ? '-' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;

export interface KpiItem {
  label: string;
  value: string;
  deltaPct: number | null;
  deltaLabel?: string;
  /** true when an increase is good (default): controls delta colour. */
  upIsGood?: boolean;
}

export function kpiGrid(flow: Flow, items: KpiItem[], columns = 4) {
  const gap = 4;
  const cardW = (CONTENT_W - gap * (columns - 1)) / columns;
  const cardH = 22;
  for (let start = 0; start < items.length; start += columns) {
    ensure(flow, cardH + gap);
    const rowItems = items.slice(start, start + columns);
    rowItems.forEach((item, index) => {
      const x = CONTENT_X + index * (cardW + gap);
      setFill(flow.pdf, EXPORT_COLORS.surface);
      setDraw(flow.pdf, EXPORT_COLORS.border);
      flow.pdf.setLineWidth(0.25);
      flow.pdf.roundedRect(x, flow.y, cardW, cardH, 1.6, 1.6, 'FD');
      setFill(flow.pdf, EXPORT_COLORS.accent);
      flow.pdf.rect(x, flow.y, cardW, 1.1, 'F');

      flow.pdf.setFont('helvetica', 'bold');
      flow.pdf.setFontSize(6.6);
      setColor(flow.pdf, EXPORT_COLORS.muted);
      flow.pdf.text(pdfSafe(item.label.toUpperCase()), x + 3.4, flow.y + 6.4);

      flow.pdf.setFontSize(15);
      setColor(flow.pdf, EXPORT_COLORS.ink);
      flow.pdf.text(pdfSafe(item.value), x + 3.4, flow.y + 14.6);

      if (item.deltaPct !== null) {
        const good = (item.upIsGood ?? true) ? item.deltaPct >= 0 : item.deltaPct <= 0;
        const chipColor = item.deltaPct === 0 ? EXPORT_COLORS.muted : good ? EXPORT_COLORS.success : EXPORT_COLORS.danger;
        const chipFill = item.deltaPct === 0 ? EXPORT_COLORS.surfaceSoft : good ? EXPORT_COLORS.successSoft : EXPORT_COLORS.dangerSoft;
        const text = pdfSafe(`${formatDelta(item.deltaPct)} vs ${item.deltaLabel ?? 'prev month'}`);
        flow.pdf.setFont('helvetica', 'bold');
        flow.pdf.setFontSize(6.2);
        const width = flow.pdf.getTextWidth(text) + 4;
        setFill(flow.pdf, chipFill);
        flow.pdf.roundedRect(x + 3.4, flow.y + 16.6, width, 4, 2, 2, 'F');
        setColor(flow.pdf, chipColor);
        flow.pdf.text(text, x + 5.4, flow.y + 19.4);
      }
    });
    flow.y += cardH + gap;
  }
}

export function barList(flow: Flow, rows: { label: string; value: number }[], color: string, maxRows = 10) {
  const list = rows.slice(0, maxRows);
  const max = Math.max(...list.map((row) => row.value), 1);
  const rowH = 8.4;
  for (const row of list) {
    ensure(flow, rowH);
    flow.pdf.setFont('helvetica', 'normal');
    flow.pdf.setFontSize(8.6);
    setColor(flow.pdf, EXPORT_COLORS.text);
    const safeLabel = pdfSafe(row.label);
    const label = safeLabel.length > 74 ? `${safeLabel.slice(0, 71)}...` : safeLabel;
    flow.pdf.text(label, CONTENT_X, flow.y + 3);
    flow.pdf.setFont('helvetica', 'bold');
    setColor(flow.pdf, EXPORT_COLORS.ink);
    flow.pdf.text(pdfSafe(formatNumber(row.value)), CONTENT_X + CONTENT_W, flow.y + 3, { align: 'right' });

    setFill(flow.pdf, EXPORT_COLORS.surfaceSoft);
    flow.pdf.roundedRect(CONTENT_X, flow.y + 4.6, CONTENT_W, 1.9, 0.95, 0.95, 'F');
    setFill(flow.pdf, color);
    flow.pdf.roundedRect(CONTENT_X, flow.y + 4.6, Math.max(2.4, (row.value / max) * CONTENT_W), 1.9, 0.95, 0.95, 'F');
    flow.y += rowH;
  }
}

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export function table(flow: Flow, columns: TableColumn[], rows: string[][], options: { highlightRow?: number } = {}) {
  const rowH = 6.4;
  const headH = 7;
  const drawHead = () => {
    setFill(flow.pdf, EXPORT_COLORS.surfaceSoft);
    flow.pdf.rect(CONTENT_X, flow.y, CONTENT_W, headH, 'F');
    setDraw(flow.pdf, EXPORT_COLORS.border);
    flow.pdf.setLineWidth(0.2);
    flow.pdf.rect(CONTENT_X, flow.y, CONTENT_W, headH, 'S');
    flow.pdf.setFont('helvetica', 'bold');
    flow.pdf.setFontSize(6.8);
    setColor(flow.pdf, EXPORT_COLORS.muted);
    let x = CONTENT_X;
    for (const column of columns) {
      const anchor = column.align === 'right' ? x + column.width - 2.4 : x + 2.4;
      flow.pdf.text(pdfSafe(column.header.toUpperCase()), anchor, flow.y + 4.6, { align: column.align === 'right' ? 'right' : 'left' });
      x += column.width;
    }
    flow.y += headH;
  };

  ensure(flow, headH + rowH * 2);
  drawHead();

  rows.forEach((cells, rowIndex) => {
    if (flow.y + rowH > CONTENT_BOTTOM) {
      flow.pdf.addPage();
      drawPdfHeader(flow.pdf, flow.chrome);
      flow.y = CONTENT_TOP + 2;
      drawHead();
    }
    const highlighted = options.highlightRow === rowIndex;
    if (highlighted) {
      setFill(flow.pdf, EXPORT_COLORS.accentSoft);
      flow.pdf.rect(CONTENT_X, flow.y, CONTENT_W, rowH, 'F');
    } else if (rowIndex % 2 === 1) {
      setFill(flow.pdf, EXPORT_COLORS.surfaceSoft);
      flow.pdf.rect(CONTENT_X, flow.y, CONTENT_W, rowH, 'F');
    }
    flow.pdf.setFont('helvetica', highlighted ? 'bold' : 'normal');
    flow.pdf.setFontSize(8.2);
    setColor(flow.pdf, highlighted ? EXPORT_COLORS.accentInk : EXPORT_COLORS.text);
    let x = CONTENT_X;
    cells.forEach((cell, columnIndex) => {
      const column = columns[columnIndex];
      if (!column) return;
      const maxChars = Math.floor(column.width / 1.55);
      const safeCell = pdfSafe(cell);
      const text = safeCell.length > maxChars ? `${safeCell.slice(0, Math.max(3, maxChars - 3))}...` : safeCell;
      const anchor = column.align === 'right' ? x + column.width - 2.4 : x + 2.4;
      flow.pdf.text(text, anchor, flow.y + 4.3, { align: column.align === 'right' ? 'right' : 'left' });
      x += column.width;
    });
    setDraw(flow.pdf, EXPORT_COLORS.border);
    flow.pdf.setLineWidth(0.12);
    flow.pdf.line(CONTENT_X, flow.y + rowH, CONTENT_X + CONTENT_W, flow.y + rowH);
    flow.y += rowH;
  });
  flow.y += 3;
}

export interface LineSeries {
  label: string;
  color: string;
  values: number[];
}

export function lineChart(flow: Flow, labels: string[], series: LineSeries[], heightMm = 52, decimals = 2) {
  ensure(flow, heightMm + 14);
  const top = flow.y;
  const left = CONTENT_X + 10;
  const width = CONTENT_W - 12;
  const plotH = heightMm - 10;
  const values = series.flatMap((entry) => entry.values);
  const max = Math.max(...values, 0.0001);

  setDraw(flow.pdf, EXPORT_COLORS.border);
  flow.pdf.setLineWidth(0.15);
  for (let grid = 0; grid <= 3; grid += 1) {
    const y = top + (plotH * grid) / 3;
    flow.pdf.line(left, y, left + width, y);
    flow.pdf.setFont('helvetica', 'normal');
    flow.pdf.setFontSize(5.8);
    setColor(flow.pdf, EXPORT_COLORS.soft);
    flow.pdf.text(pdfSafe(formatNumber(max * (1 - grid / 3), decimals)), left - 1.6, y + 1, { align: 'right' });
  }

  const xFor = (index: number) => left + (labels.length <= 1 ? width / 2 : (width * index) / (labels.length - 1));
  const yFor = (value: number) => top + plotH * (1 - value / max);

  for (const entry of series) {
    setDraw(flow.pdf, entry.color);
    flow.pdf.setLineWidth(0.55);
    for (let index = 1; index < entry.values.length; index += 1) {
      flow.pdf.line(xFor(index - 1), yFor(entry.values[index - 1]), xFor(index), yFor(entry.values[index]));
    }
    setFill(flow.pdf, entry.color);
    entry.values.forEach((value, index) => flow.pdf.circle(xFor(index), yFor(value), 0.75, 'F'));
  }

  flow.pdf.setFont('helvetica', 'normal');
  flow.pdf.setFontSize(6.2);
  setColor(flow.pdf, EXPORT_COLORS.muted);
  labels.forEach((label, index) => {
    flow.pdf.text(pdfSafe(label), xFor(index), top + plotH + 4.4, { align: 'center' });
  });

  let legendX = left;
  const legendY = top + plotH + 9;
  flow.pdf.setFontSize(6.6);
  for (const entry of series) {
    setFill(flow.pdf, entry.color);
    flow.pdf.roundedRect(legendX, legendY - 2.1, 3, 2.1, 0.6, 0.6, 'F');
    setColor(flow.pdf, EXPORT_COLORS.muted);
    const safeLabel = pdfSafe(entry.label);
    flow.pdf.text(safeLabel, legendX + 4.2, legendY - 0.3);
    legendX += flow.pdf.getTextWidth(safeLabel) + 12;
  }
  flow.y = top + heightMm + 4;
}
