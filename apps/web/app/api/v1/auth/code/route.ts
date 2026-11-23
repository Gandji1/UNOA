import type { NextRequest } from 'next/server';
import { studioPost } from '@/lib/server/route';
import { disableCode } from '@/lib/iam/local';

const options = { path: '/api/v1/auth/code', studio: '/espace', denial: 'iam.access', label: 'iam' };

export async function POST(request: NextRequest) {
  return studioPost(request, [], options, ({ settings, actor }, input) => disableCode(settings, actor, input.current));
}
