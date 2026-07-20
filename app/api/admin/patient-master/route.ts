import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';
import { PatientMasterService } from '@/lib/patient-master-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function friendlyDatabaseError(error: unknown) {
  const message = (error as Error).message;
  if (message.includes('DATABASE_URL')) return 'Database connection is not configured.';
  return 'Patient Master import could not be completed. Please try again or contact an administrator.';
}

async function requireAuth(req: NextRequest) {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) return null;
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === await authToken(secret)) return null;
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth) return auth;

  try {
    const stats = await PatientMasterService.getStats();
    return NextResponse.json({ stats });
  } catch (error) {
    return NextResponse.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth) return auth;

  const form = await req.formData();
  const file = form.get('file');
  const mode = String(form.get('mode') ?? 'preview');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Upload an Excel file before continuing.' }, { status: 400 });
  }

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Invalid file type. Upload a .xlsx or .xls workbook.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    if (mode === 'import') {
      const summary = await PatientMasterService.uploadPatientMaster(buffer);
      if (summary.errors.length) {
        return NextResponse.json({ summary, errors: summary.errors }, { status: 422 });
      }
      const stats = await PatientMasterService.getStats();
      return NextResponse.json({ summary, stats });
    }

    const summary = PatientMasterService.previewPatientMaster(buffer);
    return NextResponse.json({ summary, errors: summary.errors });
  } catch (error) {
    const message = (error as Error).message;
    if (message.toLowerCase().includes('excel') || message.toLowerCase().includes('workbook')) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
