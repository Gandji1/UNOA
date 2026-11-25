import 'server-only';
import { iamSettings } from '@/lib/iam/settings';
import { developmentMode } from '@/lib/iam/local';

// The form rule mirrors the server rule: one character while development mode is on.
export async function passwordRule() {
  const settings = iamSettings();
  const relaxed = settings ? await developmentMode(settings).catch(() => false) : false;
  return relaxed
    ? { minLength: 1, help: 'Mode développement : un seul caractère suffit.' }
    : { minLength: 12, help: '12 caractères au moins, avec majuscules, minuscules et chiffres.' };
}
