// Current-page PDF export — section-based pagination.
// The dashboard is exported section by section (see lib/export/sections.ts):
// every page carries the identical header/footer/margins, every section starts
// at the top of a new page, and no card/chart/table is ever cropped.

import {
  EXPORT_CONTENT_SELECTOR,
  EXPORT_FALLBACK_SELECTOR,
  EXPORT_SCALE,
} from './constants';
import {
  createPdf,
  drawPdfFooters,
  type PdfChrome,
} from './pdfChrome';
import { renderDashboardSections } from './sections';
import type { ExportContext } from './types';
import { waitForStableDashboard } from './waitForStable';

export function chromeForContext(context: ExportContext, title?: string): PdfChrome {
  return {
    title: title ?? context.pageName,
    subtitle: 'Executive Dashboard',
    generatedAt: context.generatedAt,
    filters: context.filters,
  };
}

export async function exportCurrentPagePdf(context: ExportContext): Promise<void> {
  const root = await waitForStableDashboard(window, {
    contentSelector: EXPORT_CONTENT_SELECTOR,
    fallbackSelector: EXPORT_FALLBACK_SELECTOR,
    timeoutMs: 60000,
  });

  const pdf = await createPdf();
  await renderDashboardSections(pdf, root, chromeForContext(context), { scale: EXPORT_SCALE });
  drawPdfFooters(pdf);
  pdf.save(`${context.slug}-${context.reportingMonth}.pdf`);
}

// Compatibility re-exports: the chrome/geometry helpers live in pdfChrome.
export {
  createPdf,
  drawPdfFooters,
  drawPdfHeader,
  setColor,
  setDraw,
  PAGE_W,
  PAGE_H,
  CONTENT_X,
  CONTENT_W,
  CONTENT_TOP,
  CONTENT_BOTTOM,
  type PdfChrome,
} from './pdfChrome';
