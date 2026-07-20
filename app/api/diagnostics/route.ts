import { NextRequest, NextResponse } from 'next/server';
import { getDiagnostics, getKpis } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = { month: p.get('month'), specialty: p.get('specialty'), doctor: p.get('doctor'), riskCarrier: p.get('riskCarrier') };
  const [tests, kpis] = await Promise.all([getDiagnostics(f), getKpis(f)]);
  return NextResponse.json({ ...tests, avgLabs: kpis.avgLabs, avgScans: kpis.avgScans });
}
