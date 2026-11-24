// Assessments (module ASS): question definitions, validation and automatic
// scoring limited to the kinds that can be scored without judgement (ASS-011).

export type QuestionKind = 'single' | 'multiple' | 'matching' | 'numeric' | 'text' | 'code' | 'file';
export const autoKinds: QuestionKind[] = ['single', 'multiple', 'matching', 'numeric'];
export const kindLabels: Record<QuestionKind, string> = {
  single: 'Choix unique', multiple: 'Choix multiples', matching: 'Appariement', numeric: 'Calcul (valeur numérique)',
  text: 'Réponse rédigée', code: 'Code', file: 'Fichier à déposer',
};

export interface QuestionDefinition { kind: QuestionKind; choices: string[]; answer: unknown; points: number }
export class AssessmentError extends Error {}

const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

// Authoring format, one value per line:
//  single/multiple: choices, the correct ones prefixed with "*"
//  matching: "left = right" pairs (the learner reorders the right-hand side)
//  numeric: "value" or "value ± tolerance"
export function parseQuestion(kind: QuestionKind, source: string, points: number): QuestionDefinition {
  if (!(points > 0 && points <= 1000)) throw new AssessmentError('Barème invalide');
  if (kind === 'single' || kind === 'multiple') {
    const items = lines(source);
    const choices = items.map(item => item.replace(/^\*\s*/, ''));
    const correct = items.flatMap((item, index) => item.startsWith('*') ? [index] : []);
    if (choices.length < 2 || choices.length > 12) throw new AssessmentError('De 2 à 12 choix');
    if (kind === 'single' ? correct.length !== 1 : correct.length < 1) throw new AssessmentError(kind === 'single' ? 'Exactement une bonne réponse' : 'Au moins une bonne réponse');
    return { kind, choices, answer: correct, points };
  }
  if (kind === 'matching') {
    const pairs = lines(source).map(line => line.split('=').map(part => part.trim()));
    if (pairs.length < 2 || pairs.some(pair => pair.length !== 2 || !pair[0] || !pair[1])) throw new AssessmentError('Paires « gauche = droite », deux au moins');
    return { kind, choices: pairs.map(pair => pair[0]), answer: pairs.map(pair => pair[1]), points };
  }
  if (kind === 'numeric') {
    const match = source.trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)(?:\s*(?:±|\+\/-)\s*(\d+(?:\.\d+)?))?$/);
    if (!match) throw new AssessmentError('Valeur attendue, éventuellement « ± tolérance »');
    return { kind, choices: [], answer: { value: Number(match[1]), tolerance: Number(match[2] ?? 0) }, points };
  }
  return { kind, choices: [], answer: null, points };
}

// Automatic score, or null when a human must grade the answer.
export function autoScore(question: QuestionDefinition, response: unknown): number | null {
  if (!autoKinds.includes(question.kind)) return null;
  if (question.kind === 'single') {
    return Array.isArray(question.answer) && Number(response) === question.answer[0] ? question.points : 0;
  }
  if (question.kind === 'multiple') {
    const expected = [...(question.answer as number[])].sort().join(',');
    const given = (Array.isArray(response) ? response : [response]).map(Number).filter(Number.isInteger).sort().join(',');
    return expected === given ? question.points : 0;
  }
  if (question.kind === 'matching') {
    const expected = question.answer as string[];
    const given = Array.isArray(response) ? response.map(String) : [];
    const right = expected.filter((value, index) => given[index] === value).length;
    return Math.round((question.points * right / expected.length) * 100) / 100;
  }
  const { value, tolerance } = question.answer as { value: number; tolerance: number };
  const number = Number(String(response ?? '').replace(',', '.'));
  return Number.isFinite(number) && Math.abs(number - value) <= tolerance + 1e-9 ? question.points : 0;
}

// Draw: a stable selection per attempt (seeded), so a reload never changes the subject.
export function draw<T>(items: T[], count: number | null, seed: string): T[] {
  let state = [...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return count && count < items.length ? shuffled.slice(0, count) : shuffled;
}

// Double grading: moderation is required when the two totals differ by more than the threshold.
export function needsModeration(first: number, second: number, maximum: number, thresholdPercent = 15) {
  return Math.abs(first - second) > (maximum * thresholdPercent) / 100;
}
