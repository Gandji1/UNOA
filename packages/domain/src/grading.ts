// Grades, credits and juries (module GRD): a deterministic engine fed by a
// versioned, published grading policy. Nothing here is country-specific: the
// scale, pass marks, rounding, compensation and resit rules come from the policy.

export type RoundingMode = 'half_up' | 'half_even' | 'down' | 'up';
export type Absence = 'none' | 'justified' | 'unjustified';
export type Outcome = 'admitted' | 'compensated' | 'resit' | 'failed' | 'incomplete';

export interface GradingPolicy {
  scaleMax: number; passMark: number; unitPassMark: number;
  rounding: RoundingMode; decimals: number;
  compensation: boolean; compensationFloor: number | null;
  resit: boolean; resitRule: 'best' | 'replace';
}

export interface UnitInput {
  unitId: string; credits: number; coefficient: number;
  first: { mark: number | null; absence: Absence } | null;
  resit: { mark: number | null; absence: Absence } | null;
}

export interface UnitResult { unitId: string; mark: number | null; passed: boolean; compensated: boolean; credits: number; missing: boolean }
export interface Deliberation { average: number | null; outcome: Outcome; credits: number; units: UnitResult[] }

export class GradingError extends Error {}

// Rounding is applied once, to the published figure, as documented by the policy (GRD-003).
export function roundMark(value: number, mode: RoundingMode, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Number((value * factor).toFixed(9));
  let result: number;
  if (mode === 'down') result = Math.floor(scaled);
  else if (mode === 'up') result = Math.ceil(scaled);
  else if (mode === 'half_even') {
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    result = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  } else result = Math.floor(scaled + 0.5);
  return result / factor;
}

export function validatePolicy(policy: GradingPolicy) {
  const { scaleMax, passMark, unitPassMark, decimals, compensationFloor } = policy;
  if (!(scaleMax > 0 && scaleMax <= 1000)) throw new GradingError('Échelle invalide');
  if (!(passMark >= 0 && passMark <= scaleMax) || !(unitPassMark >= 0 && unitPassMark <= scaleMax)) throw new GradingError('Seuils hors de l’échelle');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) throw new GradingError('De 0 à 3 décimales');
  if (policy.compensation && (compensationFloor === null || compensationFloor < 0 || compensationFloor > unitPassMark)) {
    throw new GradingError('Plancher de compensation requis, inférieur au seuil de validation');
  }
}

export function checkMark(policy: GradingPolicy, mark: number | null) {
  if (mark === null) return;
  if (!(Number.isFinite(mark) && mark >= 0 && mark <= policy.scaleMax)) throw new GradingError('Note hors de l’échelle');
}

function effective(policy: GradingPolicy, unit: UnitInput): { mark: number | null; missing: boolean } {
  const read = (entry: UnitInput['first']) => !entry ? { mark: null, missing: true }
    : entry.absence === 'justified' ? { mark: null, missing: true }
    : entry.absence === 'unjustified' ? { mark: 0, missing: false } : { mark: entry.mark, missing: entry.mark === null };
  const first = read(unit.first);
  if (!unit.resit) return first;
  const resit = read(unit.resit);
  if (resit.missing) return first.missing ? resit : first;
  if (policy.resitRule === 'replace' || first.missing) return resit;
  return { mark: Math.max(first.mark ?? 0, resit.mark ?? 0), missing: false };
}

// Deliberation of a period: coefficient-weighted average, unit validation,
// compensation only when the policy allows it, resit or failure otherwise.
export function deliberate(policy: GradingPolicy, units: UnitInput[], session: 'first' | 'resit'): Deliberation {
  validatePolicy(policy);
  if (!units.length) throw new GradingError('Aucune unité à délibérer');
  const rows = units.map(unit => {
    const { mark, missing } = effective(policy, unit);
    checkMark(policy, mark);
    return { unit, mark: mark === null ? null : roundMark(mark, policy.rounding, policy.decimals), missing };
  });
  const missing = rows.some(row => row.missing);
  const weight = rows.reduce((sum, row) => sum + row.unit.coefficient, 0);
  const average = missing || weight <= 0 ? null
    : roundMark(rows.reduce((sum, row) => sum + (row.mark ?? 0) * row.unit.coefficient, 0) / weight, policy.rounding, policy.decimals);
  const passed = (row: typeof rows[number]) => row.mark !== null && row.mark >= policy.unitPassMark;
  const compensable = !missing && policy.compensation && average !== null && average >= policy.passMark
    && rows.every(row => passed(row) || (row.mark ?? -1) >= (policy.compensationFloor ?? Infinity));
  const results: UnitResult[] = rows.map(row => {
    const ok = passed(row);
    const compensated = !ok && compensable;
    return { unitId: row.unit.unitId, mark: row.mark, passed: ok, compensated, credits: ok || compensated ? row.unit.credits : 0, missing: row.missing };
  });
  const credits = results.reduce((sum, row) => sum + row.credits, 0);
  let outcome: Outcome;
  if (results.every(row => row.passed)) outcome = 'admitted';
  else if (results.every(row => row.passed || row.compensated)) outcome = 'compensated';
  else if (session === 'first' && policy.resit) outcome = 'resit';
  else if (missing) outcome = 'incomplete';
  else outcome = 'failed';
  return { average, outcome, credits, units: results };
}

export const outcomeLabels: Record<Outcome, string> = {
  admitted: 'Admis', compensated: 'Admis par compensation', resit: 'Seconde session', failed: 'Ajourné', incomplete: 'Incomplet',
};

// Quorum of a jury: a number of members present (GRD-008).
export function hasQuorum(present: number, quorum: number) {
  return present >= quorum && quorum >= 1;
}
