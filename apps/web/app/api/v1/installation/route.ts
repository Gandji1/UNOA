import { NextResponse, type NextRequest } from 'next/server';
import { iamSettings } from '@/lib/iam/settings';
import { installPlatform } from '@/lib/iam/local';
import { readInput, storageError } from '@/lib/server/request';
import { problem, unavailable } from '@/lib/server/responses';

const path = '/api/v1/installation';

// One-time creation of the first platform administrator (ADR-0010). The answer
// carries the generated password and code secret once; nothing is logged.
export async function POST(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  try {
    const input = await readInput(request, false);
    const created = await installPlatform(settings, request.headers.get('x-setup-token'), input);
    return NextResponse.json(created, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const outcome = storageError(error, 'unoa-installation-storage', 'Installation indisponible');
    return problem(outcome.status, outcome.message, path);
  }
}
