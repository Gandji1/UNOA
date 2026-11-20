// Shared input validation for every module. A refused input raises a Problem
// carrying the HTTP status that the API layer returns; nothing here knows a
// business domain.
import { scopeIdFormat } from '@/lib/iam/settings';

export type Input = Record<string, unknown>;

export class Problem extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function ensure(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new Problem(status, message);
}

export function uuid(input: unknown) {
  ensure(typeof input === 'string' && scopeIdFormat.test(input), 400, 'Identifiant invalide');
  return input;
}

export function boundedText(input: unknown, limit: number, label: string) {
  ensure(typeof input === 'string' && input.trim().length > 0 && input.length <= limit && !input.includes('\u0000'),
    400, label + ' invalide');
  return input.trim();
}

export function optionalText(input: unknown) {
  return input === undefined || input === null || (typeof input === 'string' && input.trim() === '') ? null : input;
}

export const optional = <T>(input: unknown, read: (value: unknown) => T) => optionalText(input) === null ? null : read(input);
export const text = (limit: number, label: string) => (value: unknown) => boundedText(value, limit, label);

export function utcTime(input: unknown) {
  ensure(typeof input === 'string', 400, 'Date et heure requises');
  const value = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(input) ? input + ':00.000Z' : input;
  ensure(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 400, 'Date UTC invalide');
  const parsed = new Date(value);
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString() === value, 400, 'Date UTC invalide');
  return value;
}

export function day(input: unknown, label: string) {
  ensure(typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(input + 'T00:00:00Z')),
    400, label + ' invalide');
  return input;
}

export function numeric(input: unknown) {
  ensure(typeof input === 'number' ||
    (typeof input === 'string' && /^-?\d+(?:\.\d+)?$/.test(input.trim())), 400, 'Nombre invalide');
  const value = Number(input);
  ensure(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER, 400, 'Nombre invalide');
  return value;
}

export function integer(input: unknown, label: string, minimum: number, maximum: number) {
  const value = numeric(input);
  ensure(Number.isInteger(value) && value >= minimum && value <= maximum, 400, label + ' invalide');
  return value;
}

// Decimal amounts with at most two decimals (credits, hours, quantities).
export function amount(input: unknown, label: string, positive = false) {
  const value = numeric(input);
  ensure(value >= 0 && (!positive || value > 0) && value < 1_000_000 && Math.round(value * 100) === value * 100,
    400, label + ' invalide');
  return value;
}

export function choice<T extends string>(input: unknown, values: readonly T[], label: string): T {
  ensure(values.includes(input as T), 400, label + ' invalide');
  return input as T;
}

// HTML forms send "on" for a ticked box; JSON clients send true.
export function flag(input: unknown) {
  return input === true || input === 'on' || input === 'true';
}

export const businessCodeFormat = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export function businessCode(input: unknown, label = 'Code') {
  ensure(typeof input === 'string' && businessCodeFormat.test(input.trim()), 400, label + ' invalide');
  return input.trim();
}

export const technicalCodeFormat = /^[a-z][a-z0-9_]{0,62}$/;

export function technicalCode(input: unknown, label = 'Code technique') {
  ensure(typeof input === 'string' && technicalCodeFormat.test(input), 400, label + ' invalide');
  return input;
}

const languageFormat = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

// BCP 47 language tag checked against the runtime ICU data.
export function language(input: unknown) {
  ensure(typeof input === 'string' && languageFormat.test(input), 400, 'Langue invalide');
  try {
    ensure(Intl.getCanonicalLocales(input)[0] === input, 400, 'Langue invalide');
  } catch {
    ensure(false, 400, 'Langue invalide');
  }
  return input;
}

export function list(input: unknown, limit = 16) {
  if (input === undefined || input === null || input === '') return [];
  const values = typeof input === 'string' ? input.split(/[\s,]+/).filter(Boolean) : input;
  ensure(Array.isArray(values) && values.length <= limit, 400, 'Liste invalide');
  return values;
}

export function https(input: unknown, label: string) {
  ensure(typeof input === 'string' && /^https:\/\/[^\s]+$/.test(input) && input.length <= 2000, 400, label + ' : adresse HTTPS requise');
  try { new URL(input); } catch { ensure(false, 400, label + ' invalide'); }
  return input;
}

const timeZones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export function timeZone(input: unknown) {
  ensure(typeof input === 'string' && timeZones.has(input), 400, 'Fuseau horaire IANA inconnu');
  return input;
}
