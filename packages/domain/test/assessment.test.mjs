import test from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentError, autoScore, draw, needsModeration, parseQuestion } from '../src/assessment.ts';

test('Définition des questions et refus des définitions incohérentes', () => {
  assert.deepEqual(parseQuestion('single', 'Paris\n*Porto-Novo\nCotonou', 2).answer, [1]);
  assert.throws(() => parseQuestion('single', '*A\n*B', 1), AssessmentError);
  assert.throws(() => parseQuestion('multiple', 'A\nB', 1), /Au moins une/);
  assert.deepEqual(parseQuestion('numeric', '3,14 ± 0.01', 1).answer, { value: 3.14, tolerance: 0.01 });
  assert.throws(() => parseQuestion('matching', 'A = 1', 1), /deux au moins/);
  assert.throws(() => parseQuestion('text', '', 0), /Barème/);
});

test('Correction automatique limitée aux questions adaptées', () => {
  assert.equal(autoScore(parseQuestion('single', 'A\n*B', 2), 1), 2);
  assert.equal(autoScore(parseQuestion('single', 'A\n*B', 2), 0), 0);
  assert.equal(autoScore(parseQuestion('multiple', '*A\nB\n*C', 3), [2, 0]), 3);
  assert.equal(autoScore(parseQuestion('multiple', '*A\nB\n*C', 3), [0]), 0, 'tout ou rien');
  assert.equal(autoScore(parseQuestion('matching', 'Bénin = Porto-Novo\nTogo = Lomé\nMali = Bamako', 3), ['Porto-Novo', 'Bamako', 'Bamako']), 2);
  assert.equal(autoScore(parseQuestion('numeric', '10 ± 0.5', 4), '10,4'), 4);
  assert.equal(autoScore(parseQuestion('text', '', 5), 'Rédaction'), null, 'correction humaine');
  assert.equal(autoScore(parseQuestion('code', '', 5), 'print(1)'), null);
});

test('Tirage stable par tentative et seuil de modération', () => {
  const items = Array.from({ length: 10 }, (_, index) => index);
  assert.deepEqual(draw(items, 4, 'tentative-1'), draw(items, 4, 'tentative-1'));
  assert.equal(draw(items, 4, 'a').length, 4);
  assert.notDeepEqual(draw(items, null, 'a'), draw(items, null, 'b'));
  assert.equal(needsModeration(12, 15, 20), false);
  assert.equal(needsModeration(10, 15, 20), true);
});
