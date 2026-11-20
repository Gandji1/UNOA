import { boundedText, requireConfig, utcTime, type Input } from '@/lib/config/validation';

export const natures = ['platform', 'territory', 'jurisdiction', 'institution', 'centre', 'academic_unit'] as const;
export type Nature = typeof natures[number];
export const attachmentKinds = ['implantation', 'regulatory'] as const;
export type AttachmentKind = typeof attachmentKinds[number];

const typeCodeFormat = /^[a-z][a-z0-9_]{0,62}$/;
const languageFormat = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

// The reference lists come from the runtime ICU and IANA data, never from a
// constant written in this repository.
const timeZones = new Set(Intl.supportedValuesOf('timeZone'));
const currencies = new Set(Intl.supportedValuesOf('currency'));

export function typeCode(input: unknown) {
  requireConfig(typeof input === 'string' && typeCodeFormat.test(input), 400, 'Code de type invalide');
  return input;
}

export function nature(input: unknown) {
  requireConfig(natures.includes(input as Nature), 400, 'Nature de portée invalide');
  return input as Nature;
}

export function attachmentKind(input: unknown) {
  requireConfig(attachmentKinds.includes(input as AttachmentKind), 400, 'Type de rattachement invalide');
  return input as AttachmentKind;
}

export function language(input: unknown) {
  requireConfig(typeof input === 'string' && languageFormat.test(input), 400, 'Langue invalide');
  try {
    requireConfig(Intl.getCanonicalLocales(input)[0] === input, 400, 'Langue invalide');
  } catch {
    requireConfig(false, 400, 'Langue invalide');
  }
  return input;
}

function optional(input: unknown, read: (value: unknown) => string) {
  return input === undefined || input === null || input === '' ? null : read(input);
}

export function timeZone(input: unknown) {
  requireConfig(typeof input === 'string' && timeZones.has(input), 400, 'Fuseau horaire IANA inconnu');
  return input;
}

export function currency(input: unknown) {
  requireConfig(typeof input === 'string' && currencies.has(input), 400, 'Monnaie inconnue');
  return input;
}

export function localeTag(input: unknown) {
  requireConfig(typeof input === 'string' && input.length <= 35, 400, 'Format régional invalide');
  try {
    requireConfig(Intl.getCanonicalLocales(input)[0] === input, 400, 'Format régional invalide');
  } catch {
    requireConfig(false, 400, 'Format régional invalide');
  }
  return input;
}

export interface TerritoryAttributes {
  label: string;
  timeZone: string | null;
  currency: string | null;
  locale: string | null;
  legalName: string | null;
  contact: string | null;
  presentUntil: string | null;
}

export function attributes(input: Input): TerritoryAttributes {
  const presentUntil = optional(input.presentUntil, utcTime);
  return {
    label: boundedText(input.label, 160, 'Libellé'),
    timeZone: optional(input.timeZone, timeZone),
    currency: optional(input.currency, currency),
    locale: optional(input.locale, localeTag),
    legalName: optional(input.legalName, value => boundedText(value, 200, 'Identité légale')),
    contact: optional(input.contact, value => boundedText(value, 500, 'Contact')),
    presentUntil,
  };
}

export function typeInput(input: Input) {
  const parents = typeof input.parentTypes === 'string' ? [input.parentTypes] : input.parentTypes ?? [];
  requireConfig(Array.isArray(parents) && parents.length <= 32 && new Set(parents).size === parents.length,
    400, 'Types parents invalides');
  const kind = nature(input.nature);
  const parentTypes = parents.map(typeCode);
  requireConfig((kind === 'platform') === (parentTypes.length === 0),
    400, 'Seule la nature plateforme est dépourvue de parent autorisé');
  return { code: typeCode(input.code), label: boundedText(input.label, 120, 'Libellé'), nature: kind, parentTypes };
}
