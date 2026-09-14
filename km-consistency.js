// Port direct de src/features/vehicles/kmConsistency.ts (version React Native).
// Avertissement non bloquant : signale un km incohérent avec le dernier km connu du
// véhicule, sans jamais empêcher l'enregistrement.

const LARGE_JUMP_RATIO = 0.5; // 50 % : seuil volontairement large, juste un signal discret

export function checkKmConsistency(newKm, currentKm) {
  if (Number.isNaN(newKm) || Number.isNaN(currentKm)) return null;

  if (newKm < currentKm) {
    return `Km inférieur au dernier relevé connu (${currentKm.toLocaleString('fr-FR')} km) — à vérifier.`;
  }

  // Pas de vérification d'écart relatif si le véhicule n'a encore aucun historique
  // (current_km = 0) : toute première valeur serait alors signalée à tort.
  if (currentKm > 0 && (newKm - currentKm) / currentKm > LARGE_JUMP_RATIO) {
    return `Écart important avec le dernier km connu (${currentKm.toLocaleString('fr-FR')} km) — à vérifier.`;
  }

  return null;
}
