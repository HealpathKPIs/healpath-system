// Current-page PNG export with the same executive chrome geometry as PDFs.

import { captureElement } from './captureElement';
import {
  EXPORT_BRAND,
  EXPORT_COLORS,
  EXPORT_CONTENT_SELECTOR,
  EXPORT_FALLBACK_SELECTOR,
  EXPORT_SCALE,
} from './constants';
import type { ExportContext } from './types';
import { waitForStableDashboard } from './waitForStable';

const PNG_MARGIN = 96;
const PNG_HEADER = 118;
const PNG_FOOTER = 64;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function drawHeader(ctx: CanvasRenderingContext2D, width: number, context: ExportContext) {
  const left = PNG_MARGIN;
  const right = width - PNG_MARGIN;
  ctx.fillStyle = EXPORT_COLORS.surface;
  ctx.fillRect(0, 0, width, PNG_HEADER);

  ctx.fillStyle = EXPORT_COLORS.accentInk;
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText(EXPORT_BRAND, left, 38);

  ctx.fillStyle = EXPORT_COLORS.muted;
  ctx.font = '400 15px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Generated ${context.generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`, right, 38);
  ctx.textAlign = 'left';

  ctx.fillStyle = EXPORT_COLORS.ink;
  ctx.font = '700 19px Arial, sans-serif';
  ctx.fillText(`${context.pageName} - Executive Dashboard`, left, 72);

  const filterLine = context.filters.map((filter) => `${filter.label}: ${filter.value}`).join('   |   ');
  ctx.fillStyle = EXPORT_COLORS.muted;
  ctx.font = '400 13px Arial, sans-serif';
  ctx.fillText(filterLine.slice(0, 260), left, 99);

  ctx.strokeStyle = EXPORT_COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, PNG_HEADER - 8);
  ctx.lineTo(right, PNG_HEADER - 8);
  ctx.stroke();
}

function drawFooter(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const left = PNG_MARGIN;
  const right = width - PNG_MARGIN;
  const y = height - PNG_FOOTER;

  ctx.strokeStyle = EXPORT_COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y + 12);
  ctx.lineTo(right, y + 12);
  ctx.stroke();

  ctx.fillStyle = EXPORT_COLORS.soft;
  ctx.font = '400 14px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(EXPORT_BRAND, left, height - 24);
  ctx.textAlign = 'right';
  ctx.fillText('Executive export', right, height - 24);
  ctx.textAlign = 'left';
}

function composePng(canvas: HTMLCanvasElement, context: ExportContext): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = canvas.width + PNG_MARGIN * 2;
  output.height = canvas.height + PNG_HEADER + PNG_FOOTER;
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('PNG composition failed.');

  ctx.fillStyle = EXPORT_COLORS.surface;
  ctx.fillRect(0, 0, output.width, output.height);
  drawHeader(ctx, output.width, context);
  ctx.drawImage(canvas, PNG_MARGIN, PNG_HEADER);
  drawFooter(ctx, output.width, output.height);
  return output;
}

export async function exportCurrentPagePng(context: ExportContext): Promise<void> {
  const root = await waitForStableDashboard(window, {
    contentSelector: EXPORT_CONTENT_SELECTOR,
    fallbackSelector: EXPORT_FALLBACK_SELECTOR,
    timeoutMs: 60000,
  });

  const canvas = await captureElement(root, { scale: EXPORT_SCALE, background: '#ffffff' });
  const composed = composePng(canvas, context);
  const blob = await new Promise<Blob | null>((resolve) => composed.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG generation failed.');
  download(blob, `${context.slug}-${context.reportingMonth}.png`);
}
