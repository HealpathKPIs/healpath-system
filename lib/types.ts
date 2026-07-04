// Shared types for the HealPath BI dashboard.

export type MonthYear = string; // 'YYYY-MM'

export interface Filters {
  month?: MonthYear | null;   // null = all months
  specialty?: string | null;  // null = all specialties
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
