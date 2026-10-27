import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminApi } from '@/lib/api-auth';
import { getCurrentProfile } from '@/lib/auth-server';
import {
  CapacitySchemaMissingError,
  assertCapacitySchema,
  getCapacityPool,
  linkPractitioner,
  listPractitioners,
  listStoredNameConflicts,
  rejectPractitionerMatch,
} from '@/lib/capacity/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Doctor name matching.
 *
 * The same person is written differently in the schedule and the appointment
 * export — "Dr. Ahmed Abo Auf" against "Dr. Ahmed Abo Auf Al Hoby" — and until
 * the two are joined they appear as two rows: one holding the rostered hours
 * with no bookings, one holding the bookings with no hours. Both are wrong.
 */

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const client = await getCapacityPool().connect();
  try {
    await assertCapacitySchema(client);
    const [conflicts, practitioners] = await Promise.all([
      listStoredNameConflicts(client),
      listPractitioners(client),
    ]);
    return NextResponse.json({ conflicts, practitioners });
  } catch (error) {
    if (error instanceof CapacitySchemaMissingError) {
      return NextResponse.json({ error: error.message, missing: error.missing }, { status: 503 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  let body: { action?: string; aliasKey?: string; aliasDisplay?: string; practitionerId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const aliasKey = String(body.aliasKey ?? '').trim();
  const aliasDisplay = String(body.aliasDisplay ?? '').trim();
  const practitionerId = Number(body.practitionerId);
  if (!aliasKey || !aliasDisplay || !Number.isFinite(practitionerId)) {
    return NextResponse.json({ error: 'A name and a doctor to link it to are required.' }, { status: 400 });
  }
  if (body.action !== 'link' && body.action !== 'reject') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  const client = await getCapacityPool().connect();
  try {
    await assertCapacitySchema(client);
    await client.query('begin');

    if (body.action === 'reject') {
      await rejectPractitionerMatch(client, {
        aliasKey,
        aliasDisplay,
        practitionerId,
        decidedBy: profile?.id ?? null,
      });
      await client.query('commit');
      return NextResponse.json({ action: 'reject', aliasKey });
    }

    const moved = await linkPractitioner(client, {
      aliasKey,
      aliasDisplay,
      practitionerId,
      decidedBy: profile?.id ?? null,
    });
    await client.query('commit');
    return NextResponse.json({ action: 'link', aliasKey, ...moved });
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (error instanceof CapacitySchemaMissingError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    client.release();
  }
}
