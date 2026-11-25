import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliberate, GradingError, hasQuorum, roundMark, validatePolicy } from '../src/grading.ts';

// Two fictitious regional policies with different rules (scale, pass mark, compensation, resit).
const regionA = { scaleMax: 20, passMark: 10, unitPassMark: 10, rounding: 'half_up', decimals: 2, compensation: true, compensationFloor: 7, resit: true, resitRule: 'best' };
const regionB = { scaleMax: 100, passMark: 60, unitPassMark: 60, rounding: 'down', decimals: 0, compensation: false, compensationFloor: null, resit: true, resitRule: 'replace' };
const unit = (unitId, credits, coefficient, mark, absence = 'none') => ({ unitId, credits, coefficient, first: { mark, absence }, resit: null });

test('arrondis documentés', () => {
  assert.equal(roundMark(12.345, 'half_up', 2), 12.35);
  assert.equal(roundMark(12.345, 'down', 2), 12.34);
  assert.equal(roundMark(12.341, 'up', 2), 12.35);
  assert.equal(roundMark(2.5, 'half_even', 0), 2);
  assert.equal(roundMark(3.5, 'half_even', 0), 4);
});

test('politique validée', () => {
  assert.throws(() => validatePolicy({ ...regionA, passMark: 30 }), GradingError);
  assert.throws(() => validatePolicy({ ...regionA, compensationFloor: null }), GradingError);
  assert.throws(() => validatePolicy({ ...regionA, decimals: 5 }), GradingError);
});

test('compensation seulement si la règle la permet', () => {
  const units = [unit('a', 6, 2, 14), unit('b', 3, 1, 8)];
  const a = deliberate(regionA, units, 'first');
  assert.deepEqual([a.average, a.outcome, a.credits], [12, 'compensated', 9]);
  assert.ok(a.units.find(item => item.unitId === 'b').compensated);
  const scaled = [unit('a', 6, 2, 70), unit('b', 3, 1, 40)];
  const b = deliberate(regionB, scaled, 'first');
  assert.deepEqual([b.average, b.outcome, b.credits], [60, 'resit', 6], 'région B : pas de compensation, crédits capitalisés');
  const floor = deliberate(regionA, [unit('a', 6, 2, 16), unit('b', 3, 1, 5)], 'first');
  assert.equal(floor.outcome, 'resit', 'sous le plancher de compensation');
});

test('seconde session, absences et règle de report', () => {
  const resit = [{ unitId: 'b', credits: 3, coefficient: 1, first: { mark: 6, absence: 'none' }, resit: { mark: 12, absence: 'none' } }, unit('a', 6, 1, 11)];
  assert.equal(deliberate(regionA, resit, 'resit').outcome, 'admitted');
  const worse = [{ unitId: 'b', credits: 3, coefficient: 1, first: { mark: 9, absence: 'none' }, resit: { mark: 4, absence: 'none' } }, unit('a', 6, 1, 15)];
  assert.equal(deliberate(regionA, worse, 'resit').units[0].mark, 9, 'meilleure des deux notes');
  assert.equal(deliberate({ ...regionA, resitRule: 'replace', compensation: false }, worse, 'resit').outcome, 'failed', 'la seconde note remplace');
  const justified = deliberate(regionA, [unit('a', 6, 1, 12), unit('b', 3, 1, null, 'justified')], 'first');
  assert.deepEqual([justified.average, justified.outcome], [null, 'resit'], 'absence justifiée : renvoi en seconde session');
  assert.equal(deliberate(regionA, [unit('a', 6, 1, 12), unit('b', 3, 1, null, 'unjustified')], 'first').units[1].mark, 0, 'absence injustifiée : zéro');
  assert.equal(deliberate(regionA, [unit('a', 6, 1, 12), unit('b', 3, 1, null, 'justified')], 'resit').outcome, 'incomplete');
  assert.throws(() => deliberate(regionA, [unit('a', 6, 1, 25)], 'first'), GradingError, 'note hors échelle');
});

test('quorum', () => {
  assert.ok(hasQuorum(3, 3));
  assert.ok(!hasQuorum(2, 3));
});
