/**
 * Readiness checks shared by the import screen and the import route, so the
 * preview a person approves is judged by exactly the same rules as the commit.
 */

import type {
  AppointmentPreview,
  CapacityValidation,
  CapacityValidationLine,
  SchedulePreview,
} from './types';

/** A month of schedule is normally the Specialties and Family Medicine books. */
export const EXPECTED_SCHEDULE_FILES = 2;

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)} h`;

export function validateSchedulePreviews(
  previews: SchedulePreview[],
  fileCount = previews.length,
): CapacityValidation {
  const lines: CapacityValidationLine[] = [];
  const errors = previews.flatMap((preview) => preview.errors);

  const sheetsRead = previews.reduce((sum, preview) => sum + preview.sheetsRead, 0);
  const shiftRows = previews.reduce((sum, preview) => sum + preview.shiftRows, 0);
  const rosteredMinutes = previews.reduce((sum, preview) => sum + preview.rosteredMinutes, 0);
  const leaveMinutes = previews.reduce((sum, preview) => sum + preview.plannedLeaveMinutes, 0);
  const starts = previews.map((preview) => preview.coverageStart).filter(Boolean) as string[];
  const ends = previews.map((preview) => preview.coverageEnd).filter(Boolean) as string[];

  lines.push({
    label: 'Days read',
    ok: sheetsRead > 0,
    detail: sheetsRead ? `${sheetsRead} day sheet${sheetsRead === 1 ? '' : 's'}` : 'no day sheets found',
  });

  lines.push({
    label: 'Rostered time',
    ok: shiftRows > 0,
    detail: shiftRows ? `${shiftRows} shifts, ${hours(rosteredMinutes)}` : 'no shifts found',
  });

  // Both monthly workbooks are needed for the month's real total. One file on
  // its own silently under-reports every specialty the other one covers.
  lines.push({
    label: 'Files',
    ok: fileCount >= EXPECTED_SCHEDULE_FILES,
    detail:
      fileCount >= EXPECTED_SCHEDULE_FILES
        ? `${fileCount} workbooks`
        : `only ${fileCount} workbook - a month usually needs ${EXPECTED_SCHEDULE_FILES} (Specialties and Family Medicine)`,
  });

  lines.push({
    label: 'Coverage',
    ok: starts.length > 0,
    detail: starts.length ? `${starts.sort()[0]} to ${ends.sort()[ends.length - 1]}` : 'no dates could be read',
  });

  if (leaveMinutes > 0) {
    lines.push({
      label: 'Leave excluded',
      ok: true,
      detail: `${hours(leaveMinutes)} rostered but not worked`,
    });
  }

  return {
    // A short file count is a warning, not a blocker: a mid-month correction
    // for one clinic is a legitimate thing to upload.
    ready: errors.length === 0 && sheetsRead > 0 && shiftRows > 0,
    lines,
    errors,
  };
}

export function validateAppointmentPreview(preview: AppointmentPreview | null): CapacityValidation {
  if (!preview) {
    return { ready: false, lines: [], errors: ['No file has been read yet.'] };
  }

  const lines: CapacityValidationLine[] = [
    {
      label: 'Practitioner column',
      ok: Boolean(preview.detectedColumns.doctor),
      detail: preview.detectedColumns.doctor ?? 'not found',
    },
    {
      label: 'Date column',
      ok: Boolean(preview.detectedColumns.when),
      detail: preview.detectedColumns.when
        ? `${preview.detectedColumns.when} (read as ${preview.dateOrder === 'dmy' ? 'day/month' : 'month/day'})`
        : 'not found',
    },
    {
      label: 'Appointments read',
      ok: preview.parsedRows > 0,
      detail: `${preview.parsedRows.toLocaleString()} of ${preview.totalRows.toLocaleString()}`,
    },
    {
      label: 'Coverage',
      ok: Boolean(preview.coverageStart),
      detail: preview.coverageStart ? `${preview.coverageStart} to ${preview.coverageEnd}` : 'no dates could be read',
    },
    {
      // Shown as a positive check: the person importing should be able to see
      // that patient data was found and deliberately left behind.
      label: 'Patient data removed',
      ok: true,
      detail: preview.droppedColumns.length
        ? `${preview.droppedColumns.length} columns discarded and never stored`
        : 'no patient columns present',
    },
  ];

  if (preview.undatedRows > 0 || preview.noDoctorRows > 0) {
    lines.push({
      label: 'Rows skipped',
      ok: false,
      detail: `${preview.undatedRows} without a usable date, ${preview.noDoctorRows} without a practitioner`,
    });
  }

  return { ready: preview.errors.length === 0 && preview.parsedRows > 0, lines, errors: preview.errors };
}
