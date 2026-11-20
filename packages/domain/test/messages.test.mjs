import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMinutes, checkTemplate, eventOf, events, language, maskRecipient, render, TemplateError } from '../src/messages.ts';

test('Catalogue des événements cohérent avec ses textes par défaut', () => {
  assert.equal(new Set(events.map(item => item.code)).size, events.length);
  for (const item of events) {
    for (const lang of ['fr', 'en']) {
      checkTemplate(item.defaults[lang].subject, item.variables, 200);
      checkTemplate(item.defaults[lang].body, item.variables, 2000);
    }
  }
  assert.equal(eventOf('adm.decision').sensitive, true);
});

test('Modèles : variables déclarées seulement, aucun balisage, rendu en texte', () => {
  assert.throws(() => checkTemplate('Bonjour {{inconnue}}', ['program'], 200), TemplateError);
  assert.throws(() => checkTemplate('<b>Gras</b>', [], 200), /HTML/);
  assert.throws(() => checkTemplate('Cassé {{program', ['program'], 200), /mal formée/);
  assert.equal(render('Programme {{ program }} !', { program: 'Licence <script>' }), 'Programme Licence <script> !');
  assert.equal(render('{{a}}', {}), '');
});

test('Langue, masquage et report exponentiel', () => {
  assert.equal(language('en-GB'), 'en');
  assert.equal(language(null), 'fr');
  assert.equal(maskRecipient('awa@example.test'), 'a***@example.test');
  assert.equal(maskRecipient('+22990000012'), '+229****12');
  assert.deepEqual([1, 2, 3, 10].map(backoffMinutes), [1, 2, 4, 60]);
});
