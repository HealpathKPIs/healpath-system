// The single DOM-to-canvas capture helper used by every export path.
// html2canvas is dynamically imported so export code stays out of the main
// bundle until the user explicitly starts an export.

import { EXPORT_EXCLUDE_ATTR, EXPORT_SCALE } from './constants';

export interface CaptureOptions {
  scale?: number;
  background?: string;
  /** Document the element belongs to (for cross-iframe captures). */
  ownerDocument?: Document;
  ownerWindow?: Window;
}

const EXPORT_CAPTURE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    animation-delay: 0s !important;
    transition-delay: 0s !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  html, body { background: #ffffff !important; color: #0f172a !important; }
  .page-enter { opacity: 1 !important; transform: none !important; }
  [${EXPORT_EXCLUDE_ATTR}] { display: none !important; }
  .perf-tip { display: none !important; }

  /* Executive print cleanup: the on-screen filter/search chrome is redundant in
     a report (applied filters are printed in the PDF header band) and its
     translucent/backdrop styling rasterises badly. */
  form, .filters, .search { display: none !important; }
  /* The PDF header band already names the dashboard — the on-page title bar
     and its action links would be duplicated chrome in a report. */
  .pagehead { display: none !important; }

  /* html2canvas mis-paints the gradient pseudo-element accent bars
     (inset + color-mix combinations rasterise as grey blocks). Replace them
     with a crisp printed accent border. */
  .kpi-card::before, .overview-kpi::before, .overview-kpi::after { content: none !important; display: none !important; }
  .kpi-card, .overview-kpi { border-top: 3px solid #6366f1 !important; }

  /* Flat, print-grade surfaces: hairline borders, no shadows, no washes. */
  .card, .kpi-card, .overview-kpi, .table-wrap,
  .chronic-drill-period-card,
  [style*="color-mix"],
  [style*="color("] {
    background: #ffffff !important;
    background-image: none !important;
    box-shadow: none !important;
    border-color: #e2e6ec !important;
  }
  .perf-cell {
    background: #f8fafc !important;
    background-image: none !important;
  }
  tbody tr:hover { background: #ffffff !important; }
`;

function installCaptureCss(doc: Document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.setAttribute('data-export-capture-style', 'true');
  style.textContent = `html[data-export-capture] { background: #ffffff !important; } html[data-export-capture] ${EXPORT_CAPTURE_CSS}`;
  doc.head.appendChild(style);
  return style;
}

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

export async function captureElement(element: HTMLElement, options: CaptureOptions = {}): Promise<HTMLCanvasElement> {
  const html2canvas = (await import('html2canvas')).default;
  const doc = options.ownerDocument ?? element.ownerDocument ?? document;
  const win = options.ownerWindow ?? doc.defaultView ?? window;
  const root = doc.documentElement;
  const previousExportAttr = root.getAttribute('data-export-capture');
  const style = installCaptureCss(doc);

  try {
    root.setAttribute('data-export-capture', 'true');
    await nextFrame(win);
    return await html2canvas(element, {
      scale: options.scale ?? EXPORT_SCALE,
      backgroundColor: options.background ?? '#ffffff',
      useCORS: true,
      logging: false,
      width: element.scrollWidth,
      height: element.scrollHeight,
      windowWidth: doc.documentElement?.scrollWidth || win.innerWidth,
      windowHeight: doc.documentElement?.scrollHeight || win.innerHeight,
      scrollX: 0,
      scrollY: 0,
      ignoreElements: (node) => node.nodeType === 1 && (node as HTMLElement).hasAttribute?.(EXPORT_EXCLUDE_ATTR),
      onclone: (clonedDoc) => {
        clonedDoc.documentElement.setAttribute('data-export-capture', 'true');
        const clonedStyle = clonedDoc.createElement('style');
        clonedStyle.textContent = EXPORT_CAPTURE_CSS;
        clonedDoc.head.appendChild(clonedStyle);
        // Deterministic numbers: force every animated KPI counter to its FINAL
        // formatted value in the capture clone, so an exported report can never
        // contain a mid-animation (i.e. wrong) figure.
        for (const counter of Array.from(clonedDoc.querySelectorAll<HTMLElement>('[data-animated-number]'))) {
          const final = counter.getAttribute('data-final');
          if (final !== null) counter.textContent = final;
        }
      },
    });
  } finally {
    if (previousExportAttr === null) root.removeAttribute('data-export-capture');
    else root.setAttribute('data-export-capture', previousExportAttr);
    style.remove();
  }
}

/** Resolve the on-screen dashboard content element (with a safe fallback). */
export function resolveExportRoot(primarySelector: string, fallbackSelector: string, doc: Document = document): HTMLElement | null {
  return (doc.querySelector(primarySelector) as HTMLElement | null)
    ?? (doc.querySelector(fallbackSelector) as HTMLElement | null);
}
