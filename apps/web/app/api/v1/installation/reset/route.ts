import { NextResponse, type NextRequest } from 'next/server';
import { iamSettings } from '@/lib/iam/settings';
import { resetPlatform } from '@/lib/iam/local';
import { readInput, storageError } from '@/lib/server/request';
import { problem, unavailable } from '@/lib/server/responses';

const path = '/api/v1/installation/reset';

// Development reset (ADR-0015): erases every record and leaves one platform administrator.
export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  try {
    const input = await readInput(request, false);
    return NextResponse.json(await resetPlatform(settings, request.headers.get('x-setup-token'), input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const outcome = storageError(error, 'unoa-reset-storage', 'Remise à zéro indisponible');
    return problem(outcome.status, outcome.message, path);
  }
}
