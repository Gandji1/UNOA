import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonAccess, parseChapters, parseInline, parseMarkup } from '../packages/domain/src/learning.ts';

test('Le balisage restreint produit titres, paragraphes, listes et liens HTTPS seulement', () => {
  const blocks = parseMarkup('# Titre\nUn **mot** et un [lien](https://example.test/a).\n\n- un\n- deux\n\nFin');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'paragraph']);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[2].items.length, 2);
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ type: 'text', value: '[x](javascript:alert(1))' }]);
  assert.deepEqual(parseMarkup('<script>alert(1)</script>'), [{ type: 'paragraph', inlines: [{ type: 'text', value: '<script>alert(1)</script>' }] }]);
});

test('Accès séquentiel et conditionnel', () => {
  const modules = [
    { accessMode: 'sequential', lessons: [{ id: 'a', requires: null }, { id: 'b', requires: null }, { id: 'c', requires: null }] },
    { accessMode: 'free', lessons: [{ id: 'd', requires: 'c' }, { id: 'e', requires: null }] },
  ];
  let access = lessonAccess(modules, new Set());
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(id => access.get(id).open), [true, false, false, false, true]);
  assert.equal(access.get('d').reason, 'condition');
  access = lessonAccess(modules, new Set(['a', 'b', 'c']));
  assert.ok(['a', 'b', 'c', 'd', 'e'].every(id => access.get(id).open));
});

test('Les chapitres vidéo sont ordonnés et bornés', () => {
  assert.deepEqual(parseChapters('00:00 Introduction\n01:30 Notions\n1:02:03 Synthèse'),
    [{ at: 0, title: 'Introduction' }, { at: 90, title: 'Notions' }, { at: 3723, title: 'Synthèse' }]);
  assert.equal(parseChapters('02:00 B\n01:00 A'), null);
  assert.equal(parseChapters('99:99 Faux'), null);
});

test('Une heure locale est convertie selon le fuseau IANA, changement d’heure compris', async () => {
  const { zonedToUtc } = await import('../packages/domain/src/time.ts');
  assert.equal(zonedToUtc('2027-01-15T10:00', 'Africa/Porto-Novo').toISOString(), '2027-01-15T09:00:00.000Z');
  assert.equal(zonedToUtc('2027-01-15T10:00', 'America/Toronto').toISOString(), '2027-01-15T15:00:00.000Z');
  assert.equal(zonedToUtc('2027-07-15T10:00', 'America/Toronto').toISOString(), '2027-07-15T14:00:00.000Z');
  assert.equal(zonedToUtc('2027-07-15 10:00', 'UTC'), null);
});
