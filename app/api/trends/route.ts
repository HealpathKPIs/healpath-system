import { NextRequest, NextResponse } from 'next/server';
import { getTrends } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const data = await getTrends(p.get('specialty'), p.get('doctor'));
  return NextResponse.json(data);
}
