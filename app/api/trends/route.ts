import { NextRequest, NextResponse } from 'next/server';
import { getTrends } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const data = await getTrends(p.get('specialty'), p.get('doctor'), p.get('drug'), p.get('disease'), p.get('riskCarrier'));
  return NextResponse.json(data);
}
