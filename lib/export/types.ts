// Shared types for the Executive Export Center (Sprint 45).
// Presentation-only: nothing here touches data, queries, or APIs.

export type ExportKind = 'pdf' | 'png' | 'report';

export interface ExportFilterSummary {
  label: string;
  value: string;
}

/** Everything a header/footer/cover/filename needs — derived from the URL. */
export interface ExportContext {
  /** Human dashboard name, e.g. "Overview". */
  pageName: string;
  /** Filename stem, e.g. "overview". */
  slug: string;
  /** Filename-safe reporting period, e.g. YYYY-MM or all-months. */
  reportingMonth: string;
  /** Human reporting label, e.g. YYYY-MM or All months. */
  reportingLabel: string;
  /** Applied filters, always including the executive set (All when unset). */
  filters: ExportFilterSummary[];
  /** When the export was generated (client clock). */
  generatedAt: Date;
}

export type ExportPhase = 'idle' | 'preparing' | 'downloading';

export interface ExportProgressState {
  phase: ExportPhase;
  kind: ExportKind | null;
  /** Optional detail line, e.g. "Rendering Pharmacy (3/9)". */
  detail?: string;
}
