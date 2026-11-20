import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswers, completeness, FormError, matchesFormat, parseCriteria, parseDocuments, parseFields, weightedScore } from '../src/forms.ts';

const fields = parseFields('nom | Nom complet | text | oui\nnaissance | Date de naissance | date | oui\nserie | Série | choice | non | A;B;C\nmotivation | Motivation | textarea');
const documents = parseDocuments('releve | Relevé de notes | pdf | 1024 | oui\nphoto | Photo | jpg,png | 512 | non');

test('Le formulaire se décrit sans code et valide les réponses', () => {
  assert.equal(fields.length, 4);
  assert.deepEqual(fields[2].choices, ['A', 'B', 'C']);
  assert.deepEqual(cleanAnswers(fields, { nom: ' Awa ', serie: 'B', inconnu: 'x' }), { nom: 'Awa', serie: 'B' });
  assert.throws(() => cleanAnswers(fields, { serie: 'Z' }), FormError);
  assert.throws(() => cleanAnswers(fields, { naissance: '12/01/2000' }), FormError);
  assert.throws(() => parseFields('Nom | x | text'), FormError);
  assert.throws(() => parseFields('a | A | choice | oui'), FormError);
  assert.throws(() => parseFields('a | A\na | B'), FormError);
  assert.throws(() => parseDocuments('a | A | exe | 10'), FormError);
});

test('La complétude exige champs et pièces obligatoires non rejetées', () => {
  let state = completeness(fields, documents, { nom: 'Awa' }, []);
  assert.deepEqual(state, { complete: false, missingFields: ['Date de naissance'], missingDocuments: ['Relevé de notes'] });
  state = completeness(fields, documents, { nom: 'Awa', naissance: '2005-01-01' }, [{ key: 'releve', state: 'rejected' }]);
  assert.equal(state.complete, false);
  state = completeness(fields, documents, { nom: 'Awa', naissance: '2005-01-01' }, [{ key: 'releve', state: 'deposited' }]);
  assert.equal(state.complete, true);
});

test('La grille pondérée produit un score sur 100', () => {
  const criteria = parseCriteria('dossier | Dossier | 2 | 20\nentretien | Entretien | 1 | 10');
  assert.equal(weightedScore(criteria, { dossier: 15, entretien: 6 }), 70);
  assert.throws(() => weightedScore(criteria, { dossier: 25, entretien: 6 }), FormError);
});

test('Le format d’une pièce est contrôlé par sa signature binaire', () => {
  assert.ok(matchesFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'pdf'));
  assert.ok(!matchesFormat(new Uint8Array([0x4d, 0x5a]), 'pdf'));
});
