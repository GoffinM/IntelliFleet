import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOdometerKm, extractReceiptFields } from './parse.ts';

test('extractOdometerKm - compteur simple avec unité', () => {
  assert.equal(extractOdometerKm('ODO\n123456 km'), 123456);
});

test('extractOdometerKm - plusieurs nombres, le plus long gagne', () => {
  assert.equal(extractOdometerKm('2026\n98765\n12'), 98765);
});

test('extractOdometerKm - rien de plausible', () => {
  assert.equal(extractOdometerKm('ODO\nkm'), undefined);
});

test('extractOdometerKm - km à 3 chiffres minimum accepté', () => {
  assert.equal(extractOdometerKm('042'), 42);
});

// Cas réel terrain (2026-09-10, photo compteur de Michel) : tableau de bord avec
// échelle de vitesse (20 à 180) autour de l'affichage ODO. Bug corrigé : "80" et
// "100" (deux graduations distinctes du compteur de vitesse, reconnues comme un
// seul bloc "80 100" par ML Kit) étaient fusionnées en "80100" par l'ancienne
// heuristique de collapse des espaces, battant à tort le vrai kilométrage
// partiellement coupé "23203" (vraie valeur confirmée : 232031, dernier chiffre
// hors cadrage). Le fix retire la fusion par espaces.
test('extractOdometerKm - cas réel : tableau de bord avec échelle de vitesse', () => {
  const raw = [
    '40',
    '20',
    '60',
    'N29',
    'ODO',
    '80 100',
    'km/h',
    '23203',
    '120',
    '140',
    'H160',
    '180',
  ].join('\n');
  assert.equal(extractOdometerKm(raw), 23203);
});

test('extractReceiptFields - ticket complet FR', () => {
  assert.deepEqual(extractReceiptFields('STATION KIGALI\n20.50 L\n1750 RWF/L\nTOTAL 35875'), {
    liters: 20.5,
    unitPrice: 1750,
    amount: 35875,
  });
});

test('extractReceiptFields - ticket sans litres identifiable', () => {
  assert.deepEqual(extractReceiptFields('MONTANT: 40000 RWF\nMERCI'), { amount: 40000 });
});

test('extractReceiptFields - texte vide', () => {
  assert.deepEqual(extractReceiptFields(''), {});
});

test('extractReceiptFields - montant avec séparateur de milliers', () => {
  assert.deepEqual(extractReceiptFields('TOTAL 35 000'), { amount: 35000 });
});
