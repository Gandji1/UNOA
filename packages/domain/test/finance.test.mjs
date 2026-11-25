import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowanceAmount, FinanceError, formatMinor, instalments, minorUnits, signEvent, toMinor, verifyEvent } from '../src/finance.ts';

test('devises ISO 4217 et unités mineures', () => {
  assert.equal(minorUnits('XOF'), 0);
  assert.equal(minorUnits('EUR'), 2);
  assert.equal(minorUnits('KWD'), 3);
  assert.throws(() => minorUnits('ABC'), FinanceError);
  assert.throws(() => minorUnits('eur'), FinanceError);
  assert.equal(toMinor('12 500', 'XOF'), 12500);
  assert.equal(toMinor('12,5', 'EUR'), 1250);
  assert.throws(() => toMinor('10.5', 'XOF'), FinanceError, 'pas de décimale en XOF');
  assert.throws(() => toMinor('-3', 'EUR'), FinanceError);
  assert.match(formatMinor(1250, 'EUR'), /12,50/);
});

test('échéancier exact', () => {
  const plan = instalments(100001, 3, '2026-10-01', 30);
  assert.deepEqual(plan.map(item => item.amount), [33335, 33333, 33333]);
  assert.equal(plan.reduce((sum, item) => sum + item.amount, 0), 100001);
  assert.deepEqual(plan.map(item => item.dueOn), ['2026-10-01', '2026-10-31', '2026-11-30']);
  assert.throws(() => instalments(100, 0, '2026-10-01', 30), FinanceError);
});

test('remises plafonnées', () => {
  assert.equal(allowanceAmount(10000, 'percent', 25), 2500);
  assert.equal(allowanceAmount(10000, 'amount', 50000), 10000);
  assert.throws(() => allowanceAmount(10000, 'percent', 120), FinanceError);
});

test('signature des événements prestataire', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  const header = signEvent('secret', body);
  assert.ok(verifyEvent('secret', body, header));
  assert.ok(!verifyEvent('autre', body, header), 'mauvais secret');
  assert.ok(!verifyEvent('secret', body + ' ', header), 'corps altéré');
  assert.ok(!verifyEvent('secret', body, signEvent('secret', body, Math.floor(Date.now() / 1000) - 3600)), 'rejeu ancien');
  assert.ok(!verifyEvent('secret', body, null));
});
