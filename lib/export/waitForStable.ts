// Event-driven readiness gate for Executive Export.
//
// It deliberately does not wait for CSS animations or transitions. Decorative
// motion can run forever; export readiness is only data/content readiness:
// document loaded, fonts loaded, loading skeletons gone, and expected chart
// surfaces rendered.

export interface WaitForStableOptions {
  contentSelector: string;
  fallbackSelector: string;
  timeoutMs?: number;
}

interface ConditionResult {
  ok: boolean;
  root?: HTMLElement;
  reason?: string;
}

function waitForWindowLoad(win: Window, timeoutMs: number): Promise<void> {
  const doc = win.document;
  if (doc.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => {
      win.removeEventListener('load', onLoad);
      reject(new Error('Timed out waiting for document load.'));
    }, timeoutMs);
    const onLoad = () => {
      win.clearTimeout(timer);
      resolve();
    };
    win.addEventListener('load', onLoad, { once: true });
  });
}

async function waitForFonts(win: Window): Promise<void> {
  const fonts = (win.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) await fonts.ready;
}

function exportRoot(doc: Document, primary: string, fallback: string): HTMLElement | null {
  return (doc.querySelector(primary) as HTMLElement | null)
    ?? (doc.querySelector(fallback) as HTMLElement | null);
}

function visibleBox(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width >= 40 && box.height >= 40;
}

function chartRendered(chart: HTMLElement): ConditionResult {
  const kind = chart.dataset.exportChart;
  if (kind === 'trend-line') {
    const svg = chart.querySelector('svg');
    if (!svg) return { ok: false, reason: 'Waiting for trend chart SVG.' };
    if (!visibleBox(svg)) return { ok: false, reason: 'Waiting for trend chart layout.' };
    if (!svg.querySelector('polyline, path, circle, rect, line')) return { ok: false, reason: 'Waiting for trend chart marks.' };
  }

  if (kind === 'rank-bars') {
    if (!chart.querySelector('.rank-row')) return { ok: false, reason: 'Waiting for ranking rows.' };
    if (!chart.querySelector('.rank-fill')) return { ok: false, reason: 'Waiting for ranking bars.' };
  }

  if (kind === 'recharts') {
    const svg = chart.querySelector('svg');
    if (!svg) return { ok: false, reason: 'Waiting for Recharts SVG.' };
    if (!visibleBox(svg)) return { ok: false, reason: 'Waiting for Recharts layout.' };
    if (!svg.querySelector('path, circle, rect, text, line')) return { ok: false, reason: 'Waiting for Recharts marks.' };
  }

  return { ok: true };
}

function dashboardReady(win: Window, options: WaitForStableOptions): ConditionResult {
  const doc = win.document;
  if (doc.readyState !== 'complete') return { ok: false, reason: 'Waiting for document load.' };

  const root = exportRoot(doc, options.contentSelector, options.fallbackSelector);
  if (!root) return { ok: false, reason: 'Dashboard content not found.' };
  if (root.scrollHeight < 120 || root.scrollWidth < 320) return { ok: false, reason: 'Waiting for dashboard layout.' };
  if (doc.querySelector('[aria-busy="true"], .skeleton-line, .skeleton-block, .skeleton-card')) {
    return { ok: false, reason: 'Waiting for loading skeletons to clear.' };
  }

  // KPI counters must have finished counting — a mid-animation number in an
  // exported report would simply be a WRONG number.
  if (doc.querySelector('[data-animated-number][data-settled="false"]')) {
    return { ok: false, reason: 'Waiting for KPI counters to settle.' };
  }

  for (const chart of Array.from(root.querySelectorAll<HTMLElement>('[data-export-chart]'))) {
    const result = chartRendered(chart);
    if (!result.ok) return result;
  }

  for (const table of Array.from(root.querySelectorAll('table'))) {
    if (table.querySelector('tbody tr, tr')) continue;
    if (table.closest('.empty-state, .chart-empty, .table-empty')) continue;
    return { ok: false, reason: 'Waiting for table rows.' };
  }

  return { ok: true, root };
}

export async function waitForStableDashboard(win: Window, options: WaitForStableOptions): Promise<HTMLElement> {
  const timeoutMs = options.timeoutMs ?? 60000;
  await waitForWindowLoad(win, Math.min(20000, timeoutMs));
  await waitForFonts(win);

  return new Promise((resolve, reject) => {
    const doc = win.document;
    const observers: Array<{ disconnect(): void }> = [];
    let done = false;
    let lastReason = 'Preparing dashboard.';

    const cleanup = () => {
      win.clearTimeout(timer);
      observers.forEach((observer) => observer.disconnect());
    };

    const check = () => {
      if (done) return;
      const result = dashboardReady(win, options);
      if (!result.ok) {
        lastReason = result.reason ?? lastReason;
        return;
      }
      done = true;
      cleanup();
      resolve(result.root!);
    };

    const timer = win.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`Dashboard did not become export-ready: ${lastReason}`));
    }, timeoutMs);

    const MutationCtor = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver ?? MutationObserver;
    const mutation = new MutationCtor(check);
    mutation.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    observers.push(mutation);

    const ResizeCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const root = exportRoot(doc, options.contentSelector, options.fallbackSelector);
    if (ResizeCtor && root) {
      const resize = new ResizeCtor(check);
      resize.observe(root);
      for (const chart of Array.from(root.querySelectorAll('[data-export-chart]'))) resize.observe(chart);
      observers.push(resize);
    }

    check();
  });
}
