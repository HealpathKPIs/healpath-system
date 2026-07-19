// Shared types for the HealPath BI dashboard.

export type MonthYear = string; // 'YYYY-MM'

export interface Filters {
  month?: MonthYear | null;   // null = all months
  specialty?: string | null;  // null = all specialties
  doctor?: string | null;     // null = all doctors (practitioner_name)
  drug?: string | null;       // null = all; else visits containing this active ingredient/brand
  disease?: string | null;    // null = all; else visits containing this ICD block
  search?: string | null;     // null = none; else a case-insensitive partial term (Sprint 19)
  /** Compare-window support: include only visits whose prescription_date day-of-month <= this. */
  dayThrough?: number | null;
}

export interface Kpis {
  visits: number;
  patients: number;
  doctors: number;
  specialties: number;
  avgMeds: number;
  avgLabs: number;
  avgScans: number;
}

export interface RankRow {
  label: string;
  value: number;
}

export interface TrendPoint {
  month: MonthYear;
  meds: number;
  labs: number;
  scans: number;
  visits?: number; // present in live data (from the trend query); absent in the snapshot fallback
}

export interface TrendResponse {
  points: TrendPoint[];
  delta: {
    meds: number;
    labs: number;
    scans: number;
  };
  arrows: {
    meds: TrendArrow;
    labs: TrendArrow;
    scans: TrendArrow;
  };
}

export type TrendArrow = '▲ Increase' | '▼ Decrease' | '▬ No Change';

export interface DoctorRow {
  practitioner: string;
  specialty: string;
  visits: number;
  medsPerVisit: number;
  labsPerVisit: number;
}
