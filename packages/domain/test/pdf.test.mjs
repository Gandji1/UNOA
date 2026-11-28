import test from 'node:test';
import assert from 'node:assert/strict';
import { textPdf } from '../src/pdf.ts';

test('PDF texte : en-tête, accents encodés, pages automatiques et table des renvois', () => {
  const lines = Array.from({ length: 80 }, (_, index) => ({ text: `Ligne ${index} — compétence validée (été)` }));
  const pdf = textPdf('CV — Étudiant', [{ text: 'Curriculum vitæ', size: 18, bold: true }, ...lines]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2 /, 'deux pages');
  assert.ok(text.includes('comp\xe9tence valid\xe9e \\(\xe9t\xe9\\)'), 'accents et parenthèses échappées');
  const start = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(start).startsWith('xref'), 'renvoi xref exact');
});
