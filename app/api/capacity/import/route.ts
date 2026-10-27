import { NextResponse, type NextRequest } from 'next/server';
import type { PoolClient } from 'pg';

import { requireAdminApi } from '@/lib/api-auth';
import { getCurrentProfile } from '@/lib/auth-server';
import { parseAppointmentWorkbook } from '@/lib/capacity/appointment-parser';
import {
  CapacitySchemaMissingError,
  assertCapacitySchema,
  countWindow,
  deleteWindow,
  findFileByHash,
  getCapacityPool,
  linkPractitioner,
  listPractitioners,
  previewNameMatches,
  insertAppointments,
  insertLeave,
  insertShifts,
  resolvePractitioners,
  resolveSpecialties,
} from '@/lib/capacity/repository';
import { parseScheduleWorkbook } from '@/lib/capacity/schedule-parser';
import {
  CapacityStorageError,
  assertObjectKey,
  downloadObject,
  removeObjects,
} from '@/lib/capacity/storage';
import type {
  AppointmentPreview,
  CapacityImportKind,
  DateOrder,
  ParsedAppointmentRow,
  ParsedLeaveRow,
  ParsedShiftRow,
  SchedulePreview,
} from '@/lib/capacity/types';
import { validateAppointmentPreview, validateSchedulePreviews } from '@/lib/capacity/validate';
import { invalidateDashboardData } from '@/lib/data-refresh';
import { fingerprintBuffer } from '@/lib/import-fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Downloading ~9 MB, parsing 64k rows and writing them in 1,000-row chunks does
// not fit a short budget. Measured locally the parse alone is ~11 s.
export const maxDuration = 300;

interface IncomingFile {
  objectKey: string;
  fileName: string;
}

interface RequestBody {
  kind?: CapacityImportKind;
  files?: IncomingFile[];
  mode?: 'preview' | 'import';
  force?: boolean;
  /** Name decisions taken on the import screen, applied before resolution. */
  links?: { aliasKey: string; aliasDisplay: string; practitionerId: number }[];
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const started = Date.now();
  const trace = (message: string) => console.log(`[capacity-import +${Date.now() - started}ms] ${message}`);
  trace('1. POST handler entered');

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== 'schedule' && kind !== 'appointments') {
    return NextResponse.json({ error: 'Unknown import kind.' }, { status: 400 });
  }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return NextResponse.json({ error: 'No uploaded files were named.' }, { status: 400 });
  if (files.length > 12) return NextResponse.json({ error: 'Too many files in one import.' }, { status: 400 });

  const mode = body.mode === 'import' ? 'import' : 'preview';
  const objectKeys = files.map((file) => file.objectKey);

  try {
    for (const file of files) assertObjectKey(file.objectKey, kind);
  } catch (error) {
    const status = error instanceof CapacityStorageError ? error.status : 400;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }

  // ---------------------------------------------------------------- parse ---
  let parsed: ParsedBundle;
  try {
    trace(`2. Downloading ${files.length} file(s)`);
    parsed = await downloadAndParse(kind, files, trace);
    trace('3. Parsing finished');
  } catch (error) {
    if (error instanceof CapacityStorageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    trace(`15. Response returned (422 parse error: ${(error as Error).message})`);
    return NextResponse.json({ error: (error as Error).message }, { status: 422 });
  }

  const validation =
    kind === 'schedule'
      ? validateSchedulePreviews(parsed.schedulePreviews, files.length)
      : validateAppointmentPreview(parsed.appointmentPreview);

  if (validation.errors.length) {
    trace('15. Response returned (422 validation errors)');
    return NextResponse.json({ errors: validation.errors, validation, preview: summarise(parsed) }, { status: 422 });
  }

  const coverage = parsed.coverage;
  if (!coverage.start || !coverage.end) {
    return NextResponse.json(
      { error: 'No dates could be read from these files, so there is nothing to import.' },
      { status: 422 },
    );
  }

  const client = await getCapacityPool().connect();
  try {
    try {
      await assertCapacitySchema(client);
    } catch (error) {
      if (error instanceof CapacitySchemaMissingError) {
        return NextResponse.json({ error: error.message, missing: error.missing }, { status: 503 });
      }
      throw error;
    }

    const duplicate = await firstDuplicate(client, parsed);

    // ------------------------------------------------------------ preview ---
    if (mode === 'preview') {
      // Read-only lookups only: a preview must never open a transaction.
      const rowsToDelete = await countWindow(client, kind, coverage.start, coverage.end);
      // What every written name would resolve to, so a split like "Dr. Ahmed
      // Abo Auf" / "Dr. Ahmed Abo Auf Al Hoby" is visible and fixable before
      // it becomes two rows of results.
      const nameMatches = await previewNameMatches(client, parsed.doctors);
      const practitioners = await listPractitioners(client);
      trace('15. Response returned (preview)');
      return NextResponse.json({
        preview: summarise(parsed),
        validation,
        coverage,
        nameMatches,
        practitioners,
        replacePlan: {
          scope: 'window',
          from: coverage.start,
          to: coverage.end,
          rowsToDelete,
          rowsToInsert: parsed.rowCount,
        },
        duplicateOf: duplicate,
        files: parsed.files.map((file) => ({ fileName: file.fileName, rows: file.rows, bytes: file.bytes })),
      });
    }

    // ------------------------------------------------------------- import ---
    if (duplicate && !body.force) {
      trace('15. Response returned (409 duplicate file)');
      return NextResponse.json(
        {
          error: `"${duplicate.fileName}" has already been imported. Re-import it only if you mean to replace that data.`,
          duplicateOf: duplicate,
        },
        { status: 409 },
      );
    }

    const profile = await getCurrentProfile();

    trace('9. Beginning database transaction');
    await client.query('begin');

    const batch = await client.query<{ id: string }>(
      `insert into healpath.capacity_import_batches
         (kind, coverage_start, coverage_end, rows_parsed, status, imported_by, imported_by_email, issues)
       values ($1, $2, $3, $4, 'PREVIEW', $5, $6, $7::jsonb)
       returning id`,
      [
        kind,
        coverage.start,
        coverage.end,
        parsed.rowCount,
        profile?.id ?? null,
        profile?.email ?? null,
        JSON.stringify(parsed.issues.slice(0, 500)),
      ],
    );
    const batchId = batch.rows[0].id;

    await client.query(
      `insert into healpath.capacity_import_files
         (batch_id, file_name, file_hash, file_size_bytes, object_key, rows_parsed)
       select $1, x.file_name, x.file_hash, x.file_size_bytes, x.object_key, x.rows_parsed
         from jsonb_to_recordset($2::jsonb)
              as x(file_name text, file_hash text, file_size_bytes bigint, object_key text, rows_parsed integer)`,
      [
        batchId,
        JSON.stringify(
          parsed.files.map((file) => ({
            file_name: file.fileName,
            file_hash: file.fileHash,
            file_size_bytes: file.bytes,
            object_key: file.objectKey,
            rows_parsed: file.rows,
          })),
        ),
      ],
    );

    // Decisions made on the import screen are applied first, so resolution
    // below finds them as ordinary aliases. Doing this inside the same
    // transaction means a failed import leaves no half-applied links behind.
    let linksApplied = 0;
    for (const link of body.links ?? []) {
      if (!link?.aliasKey || !link?.aliasDisplay || !Number.isFinite(link.practitionerId)) continue;
      await linkPractitioner(client, {
        aliasKey: link.aliasKey,
        aliasDisplay: link.aliasDisplay,
        practitionerId: link.practitionerId,
        decidedBy: profile?.id ?? null,
      });
      linksApplied++;
    }
    if (linksApplied) trace(`9z. Applied ${linksApplied} name link(s) chosen before import`);

    trace('10. Resolving specialties and practitioners');
    const { map: specialties, created: specialtiesNew } = await resolveSpecialties(client, parsed.specialtyNames);
    const practitioners = await resolvePractitioners(
      client,
      parsed.doctors.map((doctor) => ({
        key: doctor.key,
        display: doctor.display,
        specialtyId: doctor.specialty ? specialties.get(doctor.specialty) ?? null : null,
      })),
    );
    trace(`10b. ${practitioners.created} new, ${practitioners.autoLinked} auto-linked, ${practitioners.needsReview.length} for review`);

    trace(`11. Replacing ${coverage.start} to ${coverage.end}`);
    const rowsDeleted = await deleteWindow(client, kind, coverage.start, coverage.end);

    trace('12. Inserting rows');
    let rowsInserted = 0;
    if (kind === 'schedule') {
      rowsInserted += await insertShifts(client, batchId, parsed.shifts, practitioners.map, specialties, trace);
      rowsInserted += await insertLeave(client, batchId, parsed.leave, practitioners.map, specialties, trace);
    } else {
      rowsInserted += await insertAppointments(
        client,
        batchId,
        parsed.appointments,
        practitioners.map,
        specialties,
        trace,
      );
    }

    const durationMs = Date.now() - started;
    await client.query(
      `update healpath.capacity_import_batches
          set status = 'COMPLETED', completed_at = now(), duration_ms = $2,
              rows_inserted = $3, rows_deleted = $4,
              rows_rejected = $5, practitioners_new = $6, specialties_new = $7
        where id = $1`,
      [
        batchId,
        durationMs,
        rowsInserted,
        rowsDeleted,
        Math.max(0, parsed.rowCount - rowsInserted),
        practitioners.created,
        specialtiesNew,
      ],
    );

    trace('14. Commit');
    await client.query('commit');
    trace('14b. Commit finished');

    invalidateDashboardData();

    trace('15. Response returned (success)');
    return NextResponse.json({
      batchId,
      kind,
      coverage,
      rowsInserted,
      rowsDeleted,
      rowsParsed: parsed.rowCount,
      practitioners: {
        created: practitioners.created,
        autoLinked: practitioners.autoLinked,
        needsReview: practitioners.needsReview.slice(0, 50),
      },
      specialtiesNew,
      linksApplied,
      issues: parsed.issues.slice(0, 200),
      durationMs,
    });
  } catch (error) {
    trace(`ERROR in transaction: ${(error as Error).message}`);
    await client.query('rollback').catch(() => undefined);
    trace('15. Response returned (500)');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    client.release();
    // A preview has not been committed to yet, so its upload must survive.
    if (mode === 'import') await removeObjects(objectKeys);
    trace('client released');
  }
}

/** Recent batches, for the import screen's history panel. */
export async function GET(req: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 10) || 10, 50);
  const client = await getCapacityPool().connect();
  try {
    await assertCapacitySchema(client);
    const { rows } = await client.query(
      `select b.id, b.kind, b.coverage_start, b.coverage_end, b.rows_inserted, b.rows_deleted,
              b.status, b.completed_at, b.duration_ms, b.imported_by_email,
              coalesce(json_agg(f.file_name) filter (where f.file_name is not null), '[]') as files
         from healpath.capacity_import_batches b
         left join healpath.capacity_import_files f on f.batch_id = b.id
        group by b.id
        order by b.started_at desc
        limit $1`,
      [limit],
    );
    return NextResponse.json({ batches: rows });
  } catch (error) {
    if (error instanceof CapacitySchemaMissingError) {
      return NextResponse.json({ batches: [], installed: false, missing: error.missing });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    client.release();
  }
}

/* ------------------------------- internals ------------------------------- */

interface ParsedFile {
  fileName: string;
  objectKey: string;
  fileHash: string;
  bytes: number;
  rows: number;
}

interface ParsedBundle {
  kind: CapacityImportKind;
  files: ParsedFile[];
  shifts: ParsedShiftRow[];
  leave: ParsedLeaveRow[];
  appointments: ParsedAppointmentRow[];
  schedulePreviews: SchedulePreview[];
  appointmentPreview: AppointmentPreview | null;
  coverage: { start: string | null; end: string | null; dates: number };
  specialtyNames: string[];
  doctors: { key: string; display: string; specialty: string | null }[];
  issues: unknown[];
  rowCount: number;
}

async function downloadAndParse(
  kind: CapacityImportKind,
  files: IncomingFile[],
  trace: (message: string) => void,
): Promise<ParsedBundle> {
  const parsedFiles: ParsedFile[] = [];
  const shifts: ParsedShiftRow[] = [];
  const leave: ParsedLeaveRow[] = [];
  const appointments: ParsedAppointmentRow[] = [];
  const schedulePreviews: SchedulePreview[] = [];
  let appointmentPreview: AppointmentPreview | null = null;
  const issues: unknown[] = [];

  for (const file of files) {
    const bytes = await downloadObject(file.objectKey);
    const fingerprint = fingerprintBuffer(bytes, file.fileName);
    trace(`2b. ${file.fileName} (${bytes.byteLength} bytes)`);

    let rows = 0;
    if (kind === 'schedule') {
      const result = parseScheduleWorkbook(bytes, trace);
      shifts.push(...result.shifts);
      leave.push(...result.leave);
      schedulePreviews.push(result.preview);
      issues.push(...result.preview.issues.map((issue) => ({ ...issue, file: file.fileName })));
      rows = result.shifts.length + result.leave.length;
    } else {
      const result = parseAppointmentWorkbook(bytes, { dateOrder: 'dmy' as DateOrder, trace });
      appointments.push(...result.rows);
      appointmentPreview = result.preview;
      rows = result.rows.length;
    }
    parsedFiles.push({
      fileName: file.fileName,
      objectKey: file.objectKey,
      fileHash: fingerprint.fileHash,
      bytes: fingerprint.fileSizeBytes,
      rows,
    });
  }

  const dates = new Set<string>();
  shifts.forEach((row) => dates.add(row.workDate));
  leave.forEach((row) => dates.add(row.workDate));
  appointments.forEach((row) => dates.add(row.apptDate));
  const ordered = [...dates].sort();

  const specialtyNames = new Set<string>();
  const doctors = new Map<string, { key: string; display: string; specialty: string | null }>();
  const remember = (key: string, display: string, specialty: string | null) => {
    if (!key) return;
    if (specialty) specialtyNames.add(specialty);
    const current = doctors.get(key);
    if (!current || display.length > current.display.length) {
      doctors.set(key, { key, display, specialty: specialty ?? current?.specialty ?? null });
    }
  };
  shifts.forEach((row) => remember(row.doctorKey, row.doctorText, row.specialtyText));
  leave.forEach((row) => remember(row.doctorKey, row.doctorText, row.specialtyText));
  appointments.forEach((row) => remember(row.doctorKey, row.doctorText, row.specialtyText));

  return {
    kind,
    files: parsedFiles,
    shifts,
    leave,
    appointments,
    schedulePreviews,
    appointmentPreview,
    coverage: { start: ordered[0] ?? null, end: ordered[ordered.length - 1] ?? null, dates: ordered.length },
    specialtyNames: [...specialtyNames],
    doctors: [...doctors.values()],
    issues,
    rowCount: shifts.length + leave.length + appointments.length,
  };
}

async function firstDuplicate(client: PoolClient, parsed: ParsedBundle) {
  for (const file of parsed.files) {
    const hit = await findFileByHash(client, file.fileHash);
    if (hit) return { ...hit, fileName: file.fileName };
  }
  return null;
}

function summarise(parsed: ParsedBundle) {
  if (parsed.kind === 'schedule') {
    const previews = parsed.schedulePreviews;
    return {
      kind: 'schedule' as const,
      files: previews.length,
      sheetsRead: previews.reduce((sum, p) => sum + p.sheetsRead, 0),
      shiftRows: previews.reduce((sum, p) => sum + p.shiftRows, 0),
      leaveRows: previews.reduce((sum, p) => sum + p.leaveRows, 0),
      rosteredMinutes: previews.reduce((sum, p) => sum + p.rosteredMinutes, 0),
      plannedLeaveMinutes: previews.reduce((sum, p) => sum + p.plannedLeaveMinutes, 0),
      distinctDoctors: parsed.doctors.length,
      distinctSpecialties: parsed.specialtyNames.sort(),
      defaultSpecialtyApplied: previews.map((p) => p.defaultSpecialtyApplied).find(Boolean) ?? null,
      missingDates: previews.flatMap((p) => p.missingDates),
    };
  }
  return { kind: 'appointments' as const, ...parsed.appointmentPreview };
}
