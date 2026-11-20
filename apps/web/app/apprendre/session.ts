import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { ConfigProblem } from '@/lib/config/validation';

export async function learner() {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  return { settings, actor };
}

export function refusedAs<T>(fallback: T) {
  return (error: unknown) => {
    if (error instanceof ConfigProblem) return fallback;
    throw error;
  };
}

export const roleLabels: Record<string, string> = { learner: 'Apprenant', teacher: 'Enseignant', tutor: 'Tuteur' };
