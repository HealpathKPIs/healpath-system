'use client';

// The unified Executive Export Center toolbar. Mounted once in the app shell;
// it renders on the seven supported executive acute dashboards and stays inert
// everywhere else. Presentation only: no data, query, or API changes.

import { useCallback, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import ExportButton from './ExportButton';
import ExportProgress from './ExportProgress';
import { currentReportingLabel, currentReportingMonth, dashboardForPath, EXPORT_EXCLUDE_ATTR } from '@/lib/export/constants';
import type { ExportContext, ExportFilterSummary, ExportProgressState } from '@/lib/export/types';

function buildFilters(params: URLSearchParams, reportingLabel: string): ExportFilterSummary[] {
  const value = (key: string, fallback = 'All') => {
    const raw = params.get(key)?.trim();
    return raw || fallback;
  };
  const comparison = params.get('compare') ?? params.get('comparison') ?? params.get('mode') ?? params.get('cmp');
  const active = Array.from(params.entries()).filter(([, v]) => v && v.trim());
  const currentFilters = active.length ? active.map(([k, v]) => `${k}=${v}`).join(', ') : 'None';
  return [
    { label: 'Reporting Month', value: params.get('month')?.trim() || reportingLabel },
    { label: 'Selected Doctor', value: value('doctor') },
    { label: 'Selected Specialty', value: value('specialty') },
    { label: 'Selected Period', value: value('period') },
    { label: 'Comparison Mode', value: comparison?.trim() || 'Off' },
    { label: 'Current Filters', value: currentFilters },
  ];
}

export default function ExportToolbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState<ExportProgressState>({ phase: 'idle', kind: null });
  const runningRef = useRef(false);

  const dashboard = dashboardForPath(pathname ?? '/');

  const buildContext = useCallback((): ExportContext => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const reportingMonth = currentReportingMonth(params.get('month'));
    const reportingLabel = currentReportingLabel(params.get('month'));
    return {
      pageName: dashboard?.name ?? 'Dashboard',
      slug: dashboard?.slug ?? 'dashboard',
      reportingMonth,
      reportingLabel,
      filters: buildFilters(params, reportingLabel),
      generatedAt: new Date(),
    };
  }, [dashboard, searchParams]);

  const run = useCallback(async (kind: ExportProgressState['kind'], task: (setDetail: (detail: string) => void) => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setProgress({ phase: 'preparing', kind });
    try {
      await task((detail) => setProgress((prev) => ({ ...prev, detail })));
      setProgress({ phase: 'downloading', kind });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Export failed:', error);
      if (typeof window !== 'undefined') window.alert(`Export failed: ${(error as Error).message}`);
    } finally {
      runningRef.current = false;
      setProgress({ phase: 'idle', kind: null });
    }
  }, []);

  const onPdf = useCallback(() => run('pdf', async () => {
    const { exportCurrentPagePdf } = await import('@/lib/export/exportPdf');
    await exportCurrentPagePdf(buildContext());
  }), [run, buildContext]);

  const onPng = useCallback(() => run('png', async () => {
    const { exportCurrentPagePng } = await import('@/lib/export/exportPng');
    await exportCurrentPagePng(buildContext());
  }), [run, buildContext]);

  const onReport = useCallback(() => run('report', async (setDetail) => {
    const { exportFullReport } = await import('@/lib/export/exportFullReport');
    const search = searchParams?.toString() ? `?${searchParams.toString()}` : '';
    await exportFullReport({
      context: buildContext(),
      search,
      onProgress: setDetail,
    });
  }), [run, buildContext, searchParams]);

  if (!dashboard) return null;
  const busy = progress.phase !== 'idle';

  return (
    <>
      <div
        {...{ [EXPORT_EXCLUDE_ATTR]: 'true' }}
        aria-label="Export toolbar"
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 80,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          maxWidth: 'calc(100vw - 36px)',
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export
        </span>
        <ExportButton onClick={onPdf} disabled={busy} title="Export the current dashboard to PDF">PDF</ExportButton>
        <ExportButton onClick={onPng} disabled={busy} title="Export the current dashboard to PNG">PNG</ExportButton>
        <ExportButton onClick={onReport} disabled={busy} variant="primary" title="Export every executive dashboard into one PDF report">Full Report</ExportButton>
      </div>
      <ExportProgress state={progress} />
    </>
  );
}
