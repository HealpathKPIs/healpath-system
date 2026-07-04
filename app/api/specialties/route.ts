import { NextRequest, NextResponse } from 'next/server';
import { getSpecialties } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const data = await getSpecialties({ month: p.get('month'), specialty: p.get('specialty') });
  return NextResponse.json(data);
}
