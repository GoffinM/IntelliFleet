import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkKmConsistency } from './kmConsistency.ts';

test('checkKmConsistency - km cohérent, pas d\'avertissement', () => {
  assert.equal(checkKmConsistency(150200, 150000), null);
});

test('checkKmConsistency - km identique au dernier connu', () => {
  assert.equal(checkKmConsistency(150000, 150000), null);
});

test('checkKmConsistency - km inférieur au dernier connu', () => {
  assert.match(checkKmConsistency(149000, 150000) ?? '', /inférieur/);
});

test('checkKmConsistency - écart relatif important (> 50%)', () => {
  assert.match(checkKmConsistency(240000, 150000) ?? '', /écart important/i);
});

test('checkKmConsistency - écart raisonnable (< 50%), pas d\'avertissement', () => {
  assert.equal(checkKmConsistency(200000, 150000), null);
});

test('checkKmConsistency - véhicule neuf (current_km=0), aucune valeur signalée', () => {
  assert.equal(checkKmConsistency(50000, 0), null);
});

test('checkKmConsistency - cas réel : 80100 (bug OCR corrigé) aurait été signalé', () => {
  assert.match(checkKmConsistency(80100, 150000) ?? '', /inférieur/);
});

test('checkKmConsistency - valeurs non numériques ignorées', () => {
  assert.equal(checkKmConsistency(NaN, 150000), null);
});
