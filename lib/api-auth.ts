import 'server-only';

import { NextResponse } from 'next/server';

import { getCurrentProfile } from '@/lib/auth-server';

export async function requireAdminApi() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (!profile.active || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }

  return null;
}

