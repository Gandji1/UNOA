// Finance (module FIN): exact amounts in ISO 4217 minor units, instalment
// plans that always add up, allowances, and the signature of provider events.
// No currency list is written here: the runtime's ISO 4217 data is used.
import { createHmac, timingSafeEqual } from 'node:crypto';

export class FinanceError extends Error {}

const supported = new Set(Intl.supportedValuesOf('currency'));

export function minorUnits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !supported.has(currency)) throw new FinanceError('Devise ISO 4217 inconnue');
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// "12 500", "12500.5" or "12,50" → integer minor units, refusing more decimals than the currency has.
export function toMinor(input: string | number, currency: string): number {
  const digits = minorUnits(currency);
  const text = String(input).trim().replace(/\s/g, '').replace(',', '.');
  const match = text.match(/^(\d{1,13})(?:\.(\d+))?$/);
  if (!match) throw new FinanceError('Montant invalide');
  const fraction = match[2] ?? '';
  if (fraction.length > digits) throw new FinanceError(`Au plus ${digits} décimale(s) pour ${currency}`);
  const value = Number(match[1]) * 10 ** digits + Number((fraction + '0'.repeat(digits)).slice(0, digits) || 0);
  if (!Number.isSafeInteger(value)) throw new FinanceError('Montant trop élevé');
  return value;
}

export function formatMinor(amount: number, currency: string, locale = 'fr-FR') {
  const digits = minorUnits(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount / 10 ** digits);
}

// Instalments: equal shares, the remainder on the first, total preserved exactly.
export function instalments(total: number, count: number, firstDue: string, intervalDays: number) {
  if (!Number.isSafeInteger(total) || total <= 0) throw new FinanceError('Total invalide');
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new FinanceError('De 1 à 24 échéances');
  if (count > 1 && !(Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 366)) throw new FinanceError('Intervalle entre échéances invalide');
  const start = Date.parse(firstDue + 'T00:00:00Z');
  if (!Number.isFinite(start)) throw new FinanceError('Date de première échéance invalide');
  const share = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => ({
    ordinal: index + 1,
    dueOn: new Date(start + index * intervalDays * 86_400_000).toISOString().slice(0, 10),
    amount: share + (index === 0 ? total - share * count : 0),
  }));
}

// Allowance (discount, scholarship, employer funding) as an amount or a percentage, never above the base.
export function allowanceAmount(base: number, kind: 'amount' | 'percent', value: number) {
  if (kind === 'percent') {
    if (!(value > 0 && value <= 100)) throw new FinanceError('Pourcentage entre 0 et 100');
    return Math.floor((base * value) / 100);
  }
  if (!Number.isSafeInteger(value) || value <= 0) throw new FinanceError('Montant de remise invalide');
  return Math.min(value, base);
}

// Provider events are signed: header "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
export function signEvent(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyEvent(secret: string, body: string, header: string | null, toleranceSeconds = 300, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=', 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
