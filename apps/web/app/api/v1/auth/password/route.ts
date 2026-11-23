import type { NextRequest } from 'next/server';
import { studioPost } from '@/lib/server/route';
import { changePassword } from '@/lib/iam/local';

const options = { path: '/api/v1/auth/password', studio: '/espace', denial: 'iam.access', label: 'iam' };

export async function POST(request: NextRequest) {
  return studioPost(request, [], options, ({ settings, actor }, input) => changePassword(settings, actor, input.current, input.password));
}
