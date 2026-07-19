// Executive Export Center constants. Presentation-only.

export const EXPORT_BRAND = 'HealPath BI';

// html2canvas capture scale (retina / high-resolution).
export const EXPORT_SCALE = 2;
export const EXPORT_REPORT_SCALE = 1;

// The captured dashboard content wrapper (rendered by PageTransition). The
// export toolbar lives outside this element, so it is never captured.
export const EXPORT_CONTENT_SELECTOR = '.page-enter';
export const EXPORT_FALLBACK_SELECTOR = '.main';

// Any element carrying this attribute is skipped by html2canvas.
export const EXPORT_EXCLUDE_ATTR = 'data-export-exclude';

// A4 landscape in millimetres, plus the header/footer/margin band used by the
// vector-text chrome that jsPDF draws around the captured raster.
export const A4_LANDSCAPE_MM = { width: 297, height: 210 };
export const EXPORT_MARGIN_MM = 10;
export const EXPORT_HEADER_MM = 18;
export const EXPORT_FOOTER_MM = 9;

// Design-system colours (hex mirrors of the CSS tokens; jsPDF/canvas need literals).
export const EXPORT_COLORS = {
  ink: '#060c18',
  text: '#0f172a',
  muted: '#64748b',
  soft: '#94a3b8',
  accent: '#6366f1',
  accentInk: '#3730a3',
  accentSoft: '#eef0ff',
  border: '#e7e9ee',
  surface: '#ffffff',
  surfaceSoft: '#f8fafc',
  success: '#059669',
  successSoft: '#ecfdf5',
  danger: '#e11d48',
  dangerSoft: '#fef2f4',
  meds: '#6366f1',
  labs: '#10b981',
  scans: '#2563eb',
};

export interface ExportDashboard {
  path: string;
  name: string;
  slug: string;
}

// Executive acute dashboards only. Chronic Care and Patient 360 are excluded
// from the toolbar and from the Full Report.
export const EXPORT_DASHBOARDS: ExportDashboard[] = [
  { path: '/', name: 'Overview', slug: 'overview' },
  { path: '/diseases', name: 'Disease & Diagnosis', slug: 'disease-diagnosis' },
  { path: '/pharmacy', name: 'Pharmacy', slug: 'pharmacy' },
  { path: '/doctors', name: 'Doctor & Specialty', slug: 'doctor-specialty' },
  { path: '/diagnostics', name: 'Labs & Scans', slug: 'labs-scans' },
  { path: '/trends', name: 'Trends', slug: 'trends' },
  { path: '/performance', name: 'Performance Matrix', slug: 'performance-matrix' },
];

/** Resolve a pathname to a supported dashboard by exact route match. */
export function dashboardForPath(pathname: string): ExportDashboard | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return EXPORT_DASHBOARDS.find((dashboard) => dashboard.path === clean) ?? null;
}

export function currentReportingMonth(monthFilter?: string | null): string {
  if (monthFilter && /^\d{4}-\d{2}/.test(monthFilter)) return monthFilter.slice(0, 7);
  return 'all-months';
}

export function currentReportingLabel(monthFilter?: string | null): string {
  if (monthFilter && /^\d{4}-\d{2}/.test(monthFilter)) return monthFilter.slice(0, 7);
  return 'All months';
}
