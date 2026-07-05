import { NextRequest, NextResponse } from 'next/server';
import { searchOptions, type SearchScope } from '@/lib/queries';

const SCOPES: SearchScope[] = ['diseases', 'pharmacy', 'diagnostics', 'doctors'];

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const scope = p.get('scope') as SearchScope | null;
  const q = p.get('q') ?? '';
  if (!scope || !SCOPES.includes(scope)) {
    return NextResponse.json({ results: [] });
  }
  const results = await searchOptions(scope, q);
  return NextResponse.json({ results });
}
