import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCurriculum, findCycle, simulatePlan } from '../packages/domain/src/curriculum.ts';

// Two fictitious structures with contradictory rules: Alpha in semesters with
// fractional credits, Bêta in modules with a different credit unit and totals.
const alpha = {
  periods: [{ ordinal: 1, label: 'S1' }, { ordinal: 2, label: 'S2' }],
  groups: [{ id: 'g', label: 'Options S2', periodOrdinal: 2, min: 1, max: 1 }],
  units: [
    { id: 'a', code: 'A1', title: 'A', periodOrdinal: 1, credits: 2.5, groupId: null },
    { id: 'b', code: 'B1', title: 'B', periodOrdinal: 1, credits: 2.5, groupId: null },
    { id: 'c', code: 'C2', title: 'C', periodOrdinal: 2, credits: 3, groupId: 'g' },
    { id: 'd', code: 'D2', title: 'D', periodOrdinal: 2, credits: 4, groupId: 'g' },
  ],
  prerequisites: [{ unitId: 'c', requiredUnitId: 'a' }],
  expectedCredits: 8,
};

test('Une maquette cohérente ne présente aucun défaut', () => {
  assert.deepEqual(checkCurriculum(alpha), []);
});

test('UE sans crédit, période vide et total hors bornes sont signalés', () => {
  const broken = {
    ...alpha,
    periods: [...alpha.periods, { ordinal: 3, label: 'S3' }],
    units: alpha.units.map(unit => unit.id === 'b' ? { ...unit, credits: 0 } : unit),
    expectedCredits: 30,
  };
  const codes = checkCurriculum(broken).map(issue => issue.code).sort();
  assert.deepEqual(codes, ['empty_period', 'total_mismatch', 'unit_without_credits']);
});

test('Un cycle et un prérequis non antérieur sont refusés', () => {
  const edges = [{ unitId: 'a', requiredUnitId: 'b' }, { unitId: 'b', requiredUnitId: 'a' }];
  assert.deepEqual(findCycle(edges), ['a', 'b', 'a']);
  const codes = checkCurriculum({ ...alpha, prerequisites: edges }).map(issue => issue.code);
  assert.ok(codes.includes('prerequisite_cycle'));
  assert.ok(codes.includes('prerequisite_order'));
});

test('Un groupe impossible à satisfaire est signalé', () => {
  const codes = checkCurriculum({ ...alpha, groups: [{ ...alpha.groups[0], min: 3, max: 3 }] }).map(issue => issue.code);
  assert.ok(codes.includes('group_unsatisfiable'));
});

test('La simulation calcule le plan et ses crédits sans dérive décimale', () => {
  const plan = simulatePlan(alpha, ['c']);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.total, 8);
  assert.deepEqual(plan.periods.map(period => [period.label, period.credits]), [['S1', 5], ['S2', 3]]);
});

test('La simulation refuse options manquantes, surnombre et choix obligatoires', () => {
  assert.deepEqual(simulatePlan(alpha, []).issues.map(issue => issue.code), ['group_below_min', 'total_mismatch']);
  assert.ok(simulatePlan(alpha, ['c', 'd']).issues.some(issue => issue.code === 'group_above_max'));
  assert.ok(simulatePlan(alpha, ['a', 'c']).issues.some(issue => issue.code === 'not_elective'));
  assert.ok(simulatePlan(alpha, ['zzz', 'c']).issues.some(issue => issue.code === 'unknown_choice'));
});

test('Une autre structure garde ses propres règles', () => {
  const beta = {
    periods: [{ ordinal: 1, label: 'Module 1' }],
    groups: [],
    units: [{ id: 'm', code: 'M1', title: 'M', periodOrdinal: 1, credits: 12, groupId: null }],
    prerequisites: [],
    expectedCredits: null,
  };
  assert.deepEqual(checkCurriculum(beta), []);
  assert.equal(simulatePlan(beta, []).total, 12);
});
