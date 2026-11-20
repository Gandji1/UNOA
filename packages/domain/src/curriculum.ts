// Curriculum rules shared by the studio, the API and the public simulator.
// The engine knows no programme, credit system or period scheme: it only
// checks the structure that an administrator has built.

export interface CurriculumPeriod { ordinal: number; label: string }
export interface CurriculumGroup { id: string; label: string; periodOrdinal: number; min: number; max: number }
export interface CurriculumUnit {
  id: string;
  code: string;
  title: string;
  periodOrdinal: number;
  credits: number;
  groupId: string | null;
}
export interface Prerequisite { unitId: string; requiredUnitId: string }
export interface CurriculumModel {
  periods: CurriculumPeriod[];
  groups: CurriculumGroup[];
  units: CurriculumUnit[];
  prerequisites: Prerequisite[];
  expectedCredits: number | null;
}

export type IssueCode =
  | 'no_period' | 'empty_period' | 'unit_without_credits' | 'empty_group' | 'group_unsatisfiable'
  | 'prerequisite_order' | 'prerequisite_cycle' | 'total_mismatch' | 'unknown_choice'
  | 'not_elective' | 'group_below_min' | 'group_above_max' | 'missing_prerequisite';

export interface Issue { code: IssueCode; subject?: string; detail?: string }

// Credits are summed in hundredths to avoid binary rounding drift.
const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

export function findCycle(edges: Prerequisite[]): string[] | null {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.unitId, [...(next.get(edge.unitId) ?? []), edge.requiredUnitId]);
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'open') return stack.slice(stack.indexOf(node)).concat(node);
    state.set(node, 'open');
    stack.push(node);
    for (const target of next.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of next.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

function groupBounds(model: CurriculumModel) {
  // Smallest and largest total reachable by a plan that respects every group.
  let low = 0;
  let high = 0;
  for (const unit of model.units) if (!unit.groupId) { low += cents(unit.credits); high += cents(unit.credits); }
  for (const group of model.groups) {
    const credits = model.units.filter(unit => unit.groupId === group.id).map(unit => cents(unit.credits))
      .sort((a, b) => a - b);
    const max = Math.min(group.max, credits.length);
    low += credits.slice(0, Math.min(group.min, credits.length)).reduce((sum, value) => sum + value, 0);
    high += credits.slice(credits.length - max).reduce((sum, value) => sum + value, 0);
  }
  return { low, high };
}

export function checkCurriculum(model: CurriculumModel): Issue[] {
  const issues: Issue[] = [];
  if (model.periods.length === 0) issues.push({ code: 'no_period' });
  for (const period of model.periods) {
    if (!model.units.some(unit => unit.periodOrdinal === period.ordinal)) {
      issues.push({ code: 'empty_period', subject: period.label });
    }
  }
  for (const unit of model.units) {
    if (cents(unit.credits) <= 0) issues.push({ code: 'unit_without_credits', subject: unit.code });
  }
  for (const group of model.groups) {
    const members = model.units.filter(unit => unit.groupId === group.id).length;
    if (members === 0) issues.push({ code: 'empty_group', subject: group.label });
    else if (members < group.min) issues.push({ code: 'group_unsatisfiable', subject: group.label });
  }
  const byId = new Map(model.units.map(unit => [unit.id, unit]));
  for (const link of model.prerequisites) {
    const unit = byId.get(link.unitId);
    const required = byId.get(link.requiredUnitId);
    if (unit && required && required.periodOrdinal >= unit.periodOrdinal) {
      issues.push({ code: 'prerequisite_order', subject: unit.code, detail: required.code });
    }
  }
  const cycle = findCycle(model.prerequisites);
  if (cycle) issues.push({ code: 'prerequisite_cycle', detail: cycle.map(id => byId.get(id)?.code ?? id).join(' → ') });
  if (model.expectedCredits !== null) {
    const { low, high } = groupBounds(model);
    const expected = cents(model.expectedCredits);
    if (expected < low || expected > high) {
      issues.push({ code: 'total_mismatch', detail: `${fromCents(low)}–${fromCents(high)} / ${model.expectedCredits}` });
    }
  }
  return issues;
}

export interface PlanPeriod { ordinal: number; label: string; credits: number; units: string[] }
export interface Plan { periods: PlanPeriod[]; total: number; issues: Issue[] }

export function simulatePlan(model: CurriculumModel, chosen: string[]): Plan {
  const issues: Issue[] = [];
  const byId = new Map(model.units.map(unit => [unit.id, unit]));
  const selected = new Set(model.units.filter(unit => !unit.groupId).map(unit => unit.id));
  for (const id of new Set(chosen)) {
    const unit = byId.get(id);
    if (!unit) issues.push({ code: 'unknown_choice', subject: id });
    else if (!unit.groupId) issues.push({ code: 'not_elective', subject: unit.code });
    else selected.add(id);
  }
  for (const group of model.groups) {
    const count = model.units.filter(unit => unit.groupId === group.id && selected.has(unit.id)).length;
    if (count < group.min) issues.push({ code: 'group_below_min', subject: group.label, detail: `${count}/${group.min}` });
    if (count > group.max) issues.push({ code: 'group_above_max', subject: group.label, detail: `${count}/${group.max}` });
  }
  for (const link of model.prerequisites) {
    if (selected.has(link.unitId) && !selected.has(link.requiredUnitId)) {
      issues.push({ code: 'missing_prerequisite', subject: byId.get(link.unitId)?.code,
        detail: byId.get(link.requiredUnitId)?.code });
    }
  }
  let total = 0;
  const periods = [...model.periods].sort((a, b) => a.ordinal - b.ordinal).map(period => {
    const units = model.units.filter(unit => unit.periodOrdinal === period.ordinal && selected.has(unit.id));
    const credits = units.reduce((sum, unit) => sum + cents(unit.credits), 0);
    total += credits;
    return { ordinal: period.ordinal, label: period.label, credits: fromCents(credits), units: units.map(unit => unit.code) };
  });
  if (model.expectedCredits !== null && total !== cents(model.expectedCredits)) {
    issues.push({ code: 'total_mismatch', detail: `${fromCents(total)} / ${model.expectedCredits}` });
  }
  return { periods, total: fromCents(total), issues };
}

export const issueMessages: Record<IssueCode, string> = {
  no_period: 'La maquette ne comporte aucune période.',
  empty_period: 'Une période ne contient aucune UE',
  unit_without_credits: 'UE sans crédits',
  empty_group: 'Groupe d’options sans UE',
  group_unsatisfiable: 'Groupe d’options impossible à satisfaire',
  prerequisite_order: 'Prérequis placé dans une période qui n’est pas antérieure',
  prerequisite_cycle: 'Cycle de prérequis',
  total_mismatch: 'Total de crédits incohérent avec le total attendu',
  unknown_choice: 'Choix inconnu',
  not_elective: 'UE obligatoire choisie comme option',
  group_below_min: 'Options insuffisantes',
  group_above_max: 'Options en surnombre',
  missing_prerequisite: 'Prérequis absent du plan',
};
