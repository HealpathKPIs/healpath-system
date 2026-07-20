import { NextRequest, NextResponse } from 'next/server';
import { getKpis } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const dayThrough = p.get('dayThrough') ? Number(p.get('dayThrough')) : null;
  const kpis = await getKpis({
    month: p.get('month'),
    specialty: p.get('specialty'),
    doctor: p.get('doctor'),
    riskCarrier: p.get('riskCarrier'),
    dayThrough: Number.isFinite(dayThrough) ? dayThrough : null,
  });
  return NextResponse.json(kpis);
}
