import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSourceOnManualEdit, shouldApplyOcr } from './useOcrTrackedField.ts';

test('nextSourceOnManualEdit - texte non vide -> manual', () => {
  assert.equal(nextSourceOnManualEdit('123'), 'manual');
});

test('nextSourceOnManualEdit - champ vidé -> null (rouvre la porte à l\'OCR)', () => {
  assert.equal(nextSourceOnManualEdit(''), null);
});

test('shouldApplyOcr - bloqué si source manual', () => {
  assert.equal(shouldApplyOcr('manual'), false);
});

test('shouldApplyOcr - autorisé si source ocr (rafraîchissement d\'un ancien résultat foireux)', () => {
  assert.equal(shouldApplyOcr('ocr'), true);
});

test('shouldApplyOcr - autorisé si aucune source (champ jamais touché ou vidé)', () => {
  assert.equal(shouldApplyOcr(null), true);
});
