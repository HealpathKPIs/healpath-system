/**
 * The contract between parsing and storage.
 *
 * Every row shape here is deliberately narrow. The appointment export carries
 * patient name, mobile, MRN, gender, age, insurance, TPA and policy holder;
 * none of it is needed to measure capacity, so none of it appears below and
 * none of it is ever written. See appointment-parser.ts for how the columns are
 * dropped before a row object exists.
 */

export type DateOrder = 'dmy' | 'mdy';

/** How a raw appointment status folds into the four states we report. */
export type StatusBucket = 'completed' | 'canceled' | 'noshow' | 'other';

export type LeaveKind = 'leave' | 'off' | 'absent' | 'unknown';

/** A problem found while reading a workbook, anchored to where it was found. */
export interface CapacityIssue {
  sheet: string;
  /** 1-based spreadsheet row, so it can be opened and corrected directly. */
  row?: number;
  date?: string;
  doctor?: string;
  /**
   * 'error'  - the row could not be used, and working time is missing
   * 'check'  - the row was used but disagrees with something else in the file
   * 'layout' - not a doctor row at all (totals, repeated headers)
   */
  kind: 'error' | 'check' | 'layout';
  message: string;
}

export interface ParsedShiftRow {
  workDate: string;
  doctorText: string;
  doctorKey: string;
  specialtyText: string | null;
  startMin: number;
  endMin: number;
  /** Set when these minutes were carried over from the previous day's shift. */
  carriedFromDate: string | null;
  fixes: string[];
  note: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface ParsedLeaveRow {
  workDate: string;
  doctorText: string;
  doctorKey: string;
  specialtyText: string | null;
  leaveKind: LeaveKind;
  /** Hours that were rostered but will not be worked. Recorded, never capacity. */
  plannedMinutes: number;
  note: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface ParsedAppointmentRow {
  apptDate: string;
  /** Minutes since midnight, or null when the export carried no time. */
  startMin: number | null;
  durationMin: number | null;
  doctorText: string;
  doctorKey: string;
  specialtyText: string | null;
  statusRaw: string;
  statusBucket: StatusBucket;
  apptType: string | null;
  apptMode: string | null;
  cancelReason: string | null;
}

export interface SchedulePreview {
  sheetsRead: number;
  sheetsSkipped: string[];
  coverageStart: string | null;
  coverageEnd: string | null;
  datesCovered: number;
  /** Dates inside the covered range with no rows at all. */
  missingDates: string[];
  shiftRows: number;
  leaveRows: number;
  rosteredMinutes: number;
  plannedLeaveMinutes: number;
  distinctDoctors: number;
  distinctSpecialties: string[];
  /**
   * The specialty applied to rows whose own cell was blank, or null when none
   * was used. The source tool silently captured the sheet title here; we report
   * it so a wrong fallback cannot pass unnoticed.
   */
  defaultSpecialtyApplied: string | null;
  issues: CapacityIssue[];
  errors: string[];
}

export interface AppointmentPreview {
  totalRows: number;
  parsedRows: number;
  undatedRows: number;
  noDoctorRows: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  datesCovered: number;
  distinctDoctors: number;
  distinctSpecialties: number;
  statusCounts: Record<StatusBucket, number>;
  rawStatusCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  durationColumnFound: boolean;
  medianDurationMin: number | null;
  detectedColumns: Record<string, string | null>;
  /** PHI columns that were present and deliberately discarded. */
  droppedColumns: string[];
  dateOrder: DateOrder;
  dateOrderSource: 'pinned' | 'detected';
  errors: string[];
}

export interface ParsedScheduleWorkbook {
  shifts: ParsedShiftRow[];
  leave: ParsedLeaveRow[];
  preview: SchedulePreview;
  errors: string[];
}

export interface ParsedAppointmentWorkbook {
  rows: ParsedAppointmentRow[];
  preview: AppointmentPreview;
  errors: string[];
}

/** One line of the import screen's readiness checklist. */
export interface CapacityValidationLine {
  label: string;
  ok: boolean;
  detail: string;
}

export interface CapacityValidation {
  ready: boolean;
  lines: CapacityValidationLine[];
  errors: string[];
}

export type CapacityImportKind = 'schedule' | 'appointments';
