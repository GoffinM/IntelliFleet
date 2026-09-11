import type { OcrFields } from './types';

// Toute cette logique est du best-effort assumé : le texte OCR brut est bruité
// (labels, unités, sauts de ligne mal placés), aucune extraction ici n'a la
// prétention d'être fiable à 100% — les champs restent éditables dans tous les cas.

function digitRunsIn(s: string): number[] {
  const matches = s.match(/\d{3,7}/g) ?? [];
  return matches
    .map((m) => parseInt(m, 10))
    .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 999999);
}

/**
 * Isole la séquence de chiffres la plus plausible comme kilométrage dans le texte
 * reconnu sur une photo de compteur. Heuristique : on cherche des suites de 3 à 7
 * chiffres par ligne (bloc/ligne tel que renvoyé par ML Kit), le plus long candidat
 * gagne, à égalité de longueur le premier rencontré l'emporte.
 *
 * Pas de fusion des espaces internes à une ligne (contrairement à une version
 * précédente) : un cas réel terrain a montré que ça fait plus de mal que de bien —
 * un tableau de bord avec échelle de vitesse (20, 40, 60, 80, 100, 120...) autour de
 * l'ODO peut faire reconnaître deux graduations voisines ("80" et "100") comme un
 * seul bloc "80 100" par ML Kit ; les fusionner en "80100" créait un faux candidat à
 * 5 chiffres qui battait le vrai kilométrage, lui aussi à 5 chiffres visibles mais
 * partiellement coupé par le cadrage ("23203" pour un vrai 232031). Voir
 * parse.test.ts pour ce cas exact en test de régression.
 */
export function extractOdometerKm(text: string): number | undefined {
  const candidates: number[] = [];
  for (const line of text.split(/\n/)) {
    candidates.push(...digitRunsIn(line));
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => String(b).length - String(a).length);
  return candidates[0];
}

/** Convertit un nombre écrit avec séparateurs (espaces, virgules, points) en entier. */
function toInt(raw: string): number {
  return parseInt(raw.replace(/\D/g, ''), 10);
}

/**
 * Tente d'identifier litres / prix unitaire / montant sur un ticket de caisse.
 * Best-effort par nature (formats de tickets très variables) : ne renvoie que les
 * champs pour lesquels un motif reconnaissable a été trouvé, jamais de valeur inventée.
 */
export function extractReceiptFields(text: string): OcrFields {
  const fields: OcrFields = {};

  const litersMatch = text.match(/(\d+[.,]\d{1,3})\s*(?:l|L|litres?)\b/);
  if (litersMatch) {
    const liters = parseFloat(litersMatch[1].replace(',', '.'));
    if (!Number.isNaN(liters)) fields.liters = liters;
  }

  const unitPriceMatch = text.match(/(\d[\d .,]*\d|\d)\s*(?:RWF)?\s*\/\s*[lL]\b/);
  if (unitPriceMatch) {
    const unitPrice = toInt(unitPriceMatch[1]);
    if (!Number.isNaN(unitPrice) && unitPrice > 0) fields.unitPrice = unitPrice;
  }

  const totalLine = text.split(/\n/).find((line) => /total|montant/i.test(line));
  const amountSource = totalLine ?? text;
  const amountCandidates = (amountSource.match(/\d[\d .,]{2,}\d/g) ?? [])
    .map(toInt)
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (amountCandidates.length > 0) {
    fields.amount = Math.max(...amountCandidates);
  }

  return fields;
}
