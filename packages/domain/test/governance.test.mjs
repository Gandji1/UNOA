import test from 'node:test';
import assert from 'node:assert/strict';
import { outcome, quorumReached, requiredPresent } from '../src/governance.ts';

test('Quorum en pourcentage des membres votants en fonction', () => {
  assert.equal(quorumReached(5, 10, 50), true);
  assert.equal(quorumReached(4, 10, 50), false);
  assert.equal(quorumReached(0, 0, 50), false);
  assert.equal(requiredPresent(7, 50), 4);
  assert.equal(requiredPresent(9, 66), 6);
});

test('Majorités : simple, absolue, deux tiers ; l’abstention ne compte jamais pour', () => {
  assert.equal(outcome('simple', { for: 3, against: 2, abstain: 5 }, 10), 'adopted');
  assert.equal(outcome('simple', { for: 2, against: 2, abstain: 0 }, 4), 'rejected', 'égalité');
  assert.equal(outcome('absolute', { for: 5, against: 1, abstain: 4 }, 10), 'rejected', 'pas plus de la moitié des présents');
  assert.equal(outcome('absolute', { for: 6, against: 1, abstain: 3 }, 10), 'adopted');
  assert.equal(outcome('two_thirds', { for: 4, against: 2, abstain: 9 }, 15), 'adopted');
  assert.equal(outcome('two_thirds', { for: 3, against: 2, abstain: 0 }, 5), 'rejected');
  assert.equal(outcome('two_thirds', { for: 0, against: 0, abstain: 3 }, 3), 'rejected');
});
