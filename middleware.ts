// Server-side auth gate. Every dashboard page and API route requires the
// signed hp_auth session cookie; unauthenticated page requests are redirected
// to /login (with a `next` return path) and API requests get 401. The gate is
// active whenever DASHBOARD_PASSWORD is configured (set it in Vercel env);
// without it the app stays open (local development convenience).

import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from './lib/auth';

// Memoize the expected token per secret (middleware runs on every request).
let cachedSecret: string | null = null;
let cachedToken: string | null = null;

async function expectedToken(secret: string): Promise<string> {
  if (cachedSecret !== secret || cachedToken === null) {
    cachedToken = await authToken(secret);
    cachedSecret = secret;
  }
  return cachedToken;
}

export async function middleware(request: NextRequest) {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) return NextResponse.next();

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === await expectedToken(secret)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + search)}` : '';
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page, the login API, and Next.js static assets.
  matcher: ['/((?!login|api/login|_next/static|_next/image|favicon.ico).*)'],
};
