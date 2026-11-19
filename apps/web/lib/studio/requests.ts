import 'server-only';
import { ConfigProblem, requireConfig, type Input } from '@/lib/config/validation';

// Shared by the configuration and territory studios: both accept a browser form
// submission and a JSON call on the same endpoint.
export async function readInput(request: Request, form: boolean, repeated: string[] = []): Promise<Input> {
  const reader = request.body?.getReader();
  requireConfig(reader, 400, 'Corps de requête requis');
  const bytes: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new ConfigProblem(413, 'Requête trop volumineuse');
    }
    bytes.push(value);
  }
  const raw = Buffer.concat(bytes).toString('utf8');
  if (form) {
    const fields = new URLSearchParams(raw);
    const lists = Object.fromEntries(repeated.map(name => [name, fields.getAll(name)]));
    return { ...Object.fromEntries(fields), ...lists };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Return the same error for malformed JSON and non-object payloads.
  }
  throw new ConfigProblem(400, 'Objet JSON invalide');
}

export function storageError(error: unknown, label: string, unavailable: string) {
  if (error instanceof ConfigProblem) return error;
  const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined;
  if (code === '23514' || code === '23503' || code === 'P0002') {
    return new ConfigProblem(422, 'Valeur ou transition incompatible avec la règle en vigueur');
  }
  if (code === '23505') {
    return new ConfigProblem(409, 'Une publication existe déjà à cette date ou la requête est déjà enregistrée');
  }
  console.error(label, typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'unknown');
  return new ConfigProblem(503, unavailable);
}
