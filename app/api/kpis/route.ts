import { NextRequest, NextResponse } from 'next/server';
import { getKpis } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kpis = await getKpis({ month: p.get('month'), specialty: p.get('specialty') });
  return NextResponse.json(kpis);
}
