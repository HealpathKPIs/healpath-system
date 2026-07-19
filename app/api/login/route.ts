import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken, passwordMatches } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) {
    // Gate not configured — nothing to verify (open access, e.g. local dev).
    return NextResponse.json({ ok: true, gate: 'disabled' });
  }

  let password = '';
  try {
    password = String(((await req.json()) as { password?: unknown })?.password ?? '');
  } catch {
    password = '';
  }

  if (!password || !(await passwordMatches(password, secret))) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, await authToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}
