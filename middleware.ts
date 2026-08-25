import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { canAccessPath, isAppRole } from '@/lib/rbac';

const PUBLIC_PATHS = new Set(['/login']);

function applyCookies(
  response: NextResponse,
  cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse['cookies']['set']>[2];
  }>,
) {
  cookiesToSet.forEach(({ name, options, value }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

function accessDenied(request: NextRequest, reason?: string) {
  const url = request.nextUrl.clone();
  url.pathname = '/access-denied';
  url.search = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return NextResponse.rewrite(url, { status: 403 });
}

function apiError(message: string, status: 401 | 403) {
  return NextResponse.json({ error: message }, { status });
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api/');
  const isPublic = PUBLIC_PATHS.has(pathname);
  const cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse['cookies']['set']>[2];
  }> = [];

  if (!supabaseUrl || !supabaseAnonKey) {
    return isApi
      ? apiError('Authentication is not configured.', 403)
      : accessDenied(request, 'configuration');
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updatedCookies) => {
        cookiesToSet.push(...updatedCookies);
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isPublic) return applyCookies(NextResponse.next(), cookiesToSet);
    if (isApi) return applyCookies(apiError('Authentication required.', 401), cookiesToSet);

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return applyCookies(NextResponse.redirect(loginUrl), cookiesToSet);
  }

  if (pathname === '/access-denied') {
    return applyCookies(NextResponse.next(), cookiesToSet);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('active, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !profile.active || !isAppRole(profile.role)) {
    if (isApi) return applyCookies(apiError('Account access is disabled.', 403), cookiesToSet);
    return applyCookies(accessDenied(request, 'disabled'), cookiesToSet);
  }

  if (isPublic) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return applyCookies(NextResponse.redirect(homeUrl), cookiesToSet);
  }

  if (!canAccessPath({ active: profile.active, role: profile.role }, pathname)) {
    if (isApi) return applyCookies(apiError('Administrator access is required.', 403), cookiesToSet);
    return applyCookies(accessDenied(request), cookiesToSet);
  }

  return applyCookies(NextResponse.next(), cookiesToSet);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
