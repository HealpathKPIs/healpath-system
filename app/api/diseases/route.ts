import { NextRequest, NextResponse } from 'next/server';
import { getDiseases, getDiseaseDescriptions } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = { month: p.get('month'), specialty: p.get('specialty') };
  const limit = Number(p.get('limit') ?? 10);
  const [blocks, descriptions] = await Promise.all([
    getDiseases(f, limit),
    getDiseaseDescriptions(f),
  ]);
  return NextResponse.json({ blocks, descriptions });
}
