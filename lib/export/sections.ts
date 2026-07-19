// Section-based PDF pagination — the core of the Executive Export Center.
//
// The PDF is built from DASHBOARD SECTIONS, not from slicing one long
// screenshot at fixed heights:
//   • each top-level dashboard section starts at the top of a new PDF page
//     (small lead-in chrome — page header / filter bar — rides with the section
//     that follows it instead of wasting a near-empty page);
//   • each section is captured as its own canvas, so its internal grid layout
//     (KPI rows, chart pairs) is preserved exactly as rendered;
//   • a section taller than one page is divided ONLY at DOM-derived safe cut
//     lines that do not pass through any atomic component — KPI cards, charts
//     (Recharts/SVG), tables, feed/alert/summary cards are never split or
//     cropped across pages. A component that does not fit in the remaining
//     space moves, whole, to the next page;
//   • an atomic component taller than a full page is scaled down to fit one
//     page rather than cropped.

import type { jsPDF } from 'jspdf';
import { captureElement, type CaptureOptions } from './captureElement';
import { EXPORT_EXCLUDE_ATTR } from './constants';
import {
  CONTENT_H,
  CONTENT_TOP,
  CONTENT_W,
  CONTENT_X,
  drawPdfHeader,
  type PdfChrome,
} from './pdfChrome';

// Components that must never be cut by a page boundary.
const ATOMIC_SELECTOR = [
  '.card',
  '.kpi-card',
  '.overview-kpi',
  '.table-wrap',
  'table',
  '[data-export-chart]',
  '.pagehead',
  '.filters',
  '.trend-chart',
  '.rank-list',
].join(', ');

// Lead-in chrome that shares a page with the section that follows it.
const LEAD_IN_SELECTOR = ['.pagehead', '.filters', 'form.filters', '.overview-header'].join(', ');
const LEAD_IN_MAX_CSS_PX = 320;

function isElementVisible(element: HTMLElement): boolean {
  if (element.hasAttribute(EXPORT_EXCLUDE_ATTR)) return false;
  const box = element.getBoundingClientRect();
  return box.width >= 24 && box.height >= 12;
}

/**
 * Top-level dashboard sections: descend through single-child wrappers from the
 * stable dashboard root, then take the visible direct children in DOM order.
 */
export function collectSections(root: HTMLElement): HTMLElement[] {
  let node: HTMLElement = root;
  for (let depth = 0; depth < 4; depth += 1) {
    const children = Array.from(node.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && isElementVisible(child),
    );
    if (children.length === 1) {
      node = children[0];
      continue;
    }
    if (children.length > 1) return children;
    break;
  }
  return [node];
}

/** Group sections into page groups: lead-in chrome rides with what follows. */
export function groupSections(sections: HTMLElement[]): HTMLElement[][] {
  const groups: HTMLElement[][] = [];
  let pending: HTMLElement[] = [];
  for (const section of sections) {
    const isLeadIn = section.matches(LEAD_IN_SELECTOR)
      && section.getBoundingClientRect().height <= LEAD_IN_MAX_CSS_PX;
    if (isLeadIn) {
      pending.push(section);
      continue;
    }
    groups.push([...pending, section]);
    pending = [];
  }
  if (pending.length) groups.push(pending);
  return groups;
}

interface AtomicBand {
  topPx: number;
  bottomPx: number;
}

/** Atomic component bands of a section, in CANVAS pixel space. */
function atomicBands(section: HTMLElement, canvas: HTMLCanvasElement): AtomicBand[] {
  const sectionBox = section.getBoundingClientRect();
  if (sectionBox.height <= 0) return [];
  const pxPerCss = canvas.height / sectionBox.height;
  const bands: AtomicBand[] = [];
  const atoms = section.matches(ATOMIC_SELECTOR)
    ? [section]
    : Array.from(section.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR));
  for (const atom of atoms) {
    if (!isElementVisible(atom)) continue;
    const box = atom.getBoundingClientRect();
    bands.push({
      topPx: (box.top - sectionBox.top) * pxPerCss,
      bottomPx: (box.bottom - sectionBox.top) * pxPerCss,
    });
  }
  return bands;
}

const CUT_EPSILON_PX = 2;

function cutIsSafe(y: number, bands: AtomicBand[]): boolean {
  return !bands.some((band) => y > band.topPx + CUT_EPSILON_PX && y < band.bottomPx - CUT_EPSILON_PX);
}

/**
 * Slice boundaries for a section canvas, derived from DOM component bounds.
 * Every returned segment either fits the page or is a single atomic component
 * (which the placer scales to fit rather than crops).
 */
function computeSegments(canvas: HTMLCanvasElement, bands: AtomicBand[], capacityPx: number): Array<{ from: number; to: number }> {
  const segments: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  while (cursor < canvas.height - 1) {
    const limit = cursor + capacityPx;
    if (limit >= canvas.height) {
      segments.push({ from: cursor, to: canvas.height });
      break;
    }
    // Best safe cut at or below the capacity limit.
    let cut = -1;
    for (let y = Math.floor(limit); y > cursor + 40; y -= 1) {
      if (cutIsSafe(y, bands)) {
        cut = y;
        break;
      }
    }
    if (cut < 0) {
      // A component straddles the whole window. If it starts after the cursor,
      // cut just before it (it moves whole to the next page); otherwise it is
      // taller than a page — emit it alone and let the placer scale it.
      const blocking = bands
        .filter((band) => band.topPx <= limit && band.bottomPx > limit)
        .sort((a, b) => a.topPx - b.topPx)[0];
      if (blocking && blocking.topPx > cursor + CUT_EPSILON_PX) {
        cut = Math.floor(blocking.topPx);
      } else if (blocking) {
        cut = Math.min(Math.ceil(blocking.bottomPx), canvas.height);
      } else {
        cut = Math.floor(limit);
      }
    }
    segments.push({ from: cursor, to: cut });
    cursor = cut;
  }
  return segments.filter((segment) => segment.to - segment.from > 4);
}

function sliceCanvas(canvas: HTMLCanvasElement, from: number, to: number): HTMLCanvasElement {
  const slice = document.createElement('canvas');
  slice.width = canvas.width;
  slice.height = Math.max(1, to - from);
  const ctx = slice.getContext('2d');
  if (!ctx) throw new Error('PDF segment generation failed.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(canvas, 0, from, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
  return slice;
}

export interface SectionRenderState {
  /** mm cursor from CONTENT_TOP on the current page. */
  usedMm: number;
  pageHasContent: boolean;
}

/**
 * Render one dashboard (its stable root) into the PDF, section by section.
 * The first section is drawn on the CURRENT page; every following section
 * starts at the top of a new page. Returns the number of pages used.
 */
export async function renderDashboardSections(
  pdf: jsPDF,
  root: HTMLElement,
  chrome: PdfChrome,
  capture: CaptureOptions = {},
): Promise<number> {
  const groups = groupSections(collectSections(root));
  let pages = 0;

  const newPage = () => {
    if (pages > 0) pdf.addPage();
    drawPdfHeader(pdf, chrome);
    pages += 1;
  };

  newPage();
  let usedMm = 0;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    // Every section (group) starts at the top of a new page.
    if (groupIndex > 0) {
      newPage();
      usedMm = 0;
    }
    for (const section of groups[groupIndex]) {
      const canvas = await captureElement(section, { ...capture, background: '#ffffff' });
      if (canvas.width < 8 || canvas.height < 8) continue;
      const mmPerPx = CONTENT_W / canvas.width;
      const capacityPx = Math.max(60, Math.floor(CONTENT_H / mmPerPx));
      const bands = atomicBands(section, canvas);
      const segments = computeSegments(canvas, bands, capacityPx);

      for (const segment of segments) {
        const segmentHeightMm = (segment.to - segment.from) * mmPerPx;
        // Move whole segments that no longer fit to the next page.
        if (usedMm > 0 && usedMm + segmentHeightMm > CONTENT_H + 0.5) {
          newPage();
          usedMm = 0;
        }
        const slice = segments.length === 1 && segment.from === 0 && segment.to === canvas.height
          ? canvas
          : sliceCanvas(canvas, segment.from, segment.to);
        // An atomic taller than the page: scale to fit — never crop.
        const scale = Math.min(1, CONTENT_H / segmentHeightMm);
        const drawW = CONTENT_W * scale;
        const drawH = segmentHeightMm * scale;
        const x = CONTENT_X + (CONTENT_W - drawW) / 2;
        pdf.addImage(slice.toDataURL('image/png'), 'PNG', x, CONTENT_TOP + usedMm, drawW, drawH, undefined, 'FAST');
        if (slice !== canvas) {
          slice.width = 0;
          slice.height = 0;
        }
        usedMm += drawH + 3; // small gutter between stacked blocks
      }
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return pages;
}
