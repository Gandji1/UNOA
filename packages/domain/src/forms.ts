// No-code application forms: the administration writes one field per line,
// the engine validates answers and computes completeness. No code is executed.

export type FieldType = 'text' | 'textarea' | 'email' | 'date' | 'number' | 'choice';
export interface FormField { key: string; label: string; type: FieldType; required: boolean; choices: string[] }
export interface DocumentRule { key: string; label: string; formats: string[]; maxKb: number; required: boolean }
export interface Criterion { key: string; label: string; weight: number; max: number }

const keyFormat = /^[a-z][a-z0-9_]{0,40}$/;
const types: FieldType[] = ['text', 'textarea', 'email', 'date', 'number', 'choice'];
export const documentFormats: Record<string, { mime: string; magic: number[] }> = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
};

const lines = (source: string) => source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const cells = (line: string) => line.split('|').map(cell => cell.trim());
const yes = (value: string | undefined) => ['oui', 'yes', 'o', 'true', '1', 'obligatoire'].includes((value ?? '').toLowerCase());

export class FormError extends Error {}

function uniqueKeys<T extends { key: string }>(items: T[]) {
  if (new Set(items.map(item => item.key)).size !== items.length) throw new FormError('Clés en double');
  return items;
}

// « clé | libellé | type | obligatoire | choix1 ; choix2 »
export function parseFields(source: string): FormField[] {
  return uniqueKeys(lines(source).map(line => {
    const [key, label, type = 'text', required, choices = ''] = cells(line);
    if (!keyFormat.test(key ?? '') || !label || label.length > 200 || !types.includes(type as FieldType)) {
      throw new FormError('Champ invalide : ' + line);
    }
    const options = choices.split(';').map(item => item.trim()).filter(Boolean);
    if ((type === 'choice') !== (options.length > 0)) throw new FormError('Choix incohérents : ' + line);
    return { key, label, type: type as FieldType, required: yes(required), choices: options };
  }));
}

// « clé | libellé | pdf,jpg | taille max en Ko | obligatoire »
export function parseDocuments(source: string): DocumentRule[] {
  return uniqueKeys(lines(source).map(line => {
    const [key, label, formats = 'pdf', size = '2048', required] = cells(line);
    const list = formats.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
    const maxKb = Number(size);
    if (!keyFormat.test(key ?? '') || !label || !list.length || list.some(item => !documentFormats[item])
      || !Number.isInteger(maxKb) || maxKb < 1 || maxKb > 5120) {
      throw new FormError('Pièce invalide : ' + line);
    }
    return { key, label, formats: list, maxKb, required: required === undefined ? true : yes(required) };
  }));
}

// « clé | libellé | poids | note maximale »
export function parseCriteria(source: string): Criterion[] {
  return uniqueKeys(lines(source).map(line => {
    const [key, label, weight = '1', max = '10'] = cells(line);
    const w = Number(weight); const m = Number(max);
    if (!keyFormat.test(key ?? '') || !label || !(w > 0 && w <= 100) || !(m > 0 && m <= 1000)) {
      throw new FormError('Critère invalide : ' + line);
    }
    return { key, label, weight: w, max: m };
  }));
}

export function cleanAnswers(fields: FormField[], input: Record<string, unknown>) {
  const answers: Record<string, string> = {};
  for (const field of fields) {
    const raw = input[field.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();
    if (value.length > (field.type === 'textarea' ? 8000 : 500)) throw new FormError('Réponse trop longue : ' + field.label);
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new FormError('Adresse invalide : ' + field.label);
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FormError('Date invalide : ' + field.label);
    if (field.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) throw new FormError('Nombre invalide : ' + field.label);
    if (field.type === 'choice' && !field.choices.includes(value)) throw new FormError('Choix invalide : ' + field.label);
    answers[field.key] = value;
  }
  return answers;
}

export interface Completeness { complete: boolean; missingFields: string[]; missingDocuments: string[] }

export function completeness(fields: FormField[], documents: DocumentRule[], answers: Record<string, string>,
  deposited: { key: string; state: string }[]): Completeness {
  const missingFields = fields.filter(field => field.required && !answers[field.key]).map(field => field.label);
  const missingDocuments = documents.filter(rule => rule.required &&
    !deposited.some(item => item.key === rule.key && item.state !== 'rejected')).map(rule => rule.label);
  return { complete: !missingFields.length && !missingDocuments.length, missingFields, missingDocuments };
}

// Weighted score out of 100; every criterion must be scored within its bounds.
export function weightedScore(criteria: Criterion[], scores: Record<string, unknown>) {
  if (!criteria.length) return null;
  let total = 0; let weights = 0;
  for (const criterion of criteria) {
    const value = Number(scores[criterion.key]);
    if (!Number.isFinite(value) || value < 0 || value > criterion.max) throw new FormError('Note invalide : ' + criterion.label);
    total += (value / criterion.max) * criterion.weight;
    weights += criterion.weight;
  }
  return Math.round((total / weights) * 10000) / 100;
}

export function matchesFormat(bytes: Uint8Array, format: string) {
  const rule = documentFormats[format];
  return !!rule && rule.magic.every((byte, index) => bytes[index] === byte);
}
