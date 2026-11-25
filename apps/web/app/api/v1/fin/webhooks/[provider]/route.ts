import { NextResponse, type NextRequest } from 'next/server';
import { iamSettings } from '@/lib/iam/settings';
import { Problem } from '@/lib/shared/validation';
import { processProviderEvent } from '@/lib/finance/store';

type RouteContext = { params: Promise<{ provider: string }> };

// Provider notifications: authenticated by their signature (no session, no browser origin).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { provider } = await params;
  const settings = iamSettings();
  if (!settings || !/^[a-z][a-z0-9_]{1,30}$/.test(provider)) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const body = await request.text();
  if (body.length > 65_536) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  try {
    const result = await processProviderEvent(settings, provider, body, request.headers.get('x-unoa-signature'));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Problem) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('unoa-fin-webhook', typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
