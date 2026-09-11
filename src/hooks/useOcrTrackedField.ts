import { useCallback, useState } from 'react';

export type FieldSource = 'ocr' | 'manual' | null;

/** Vider un champ à la main réinitialise la protection : "j'efface pour redonner sa chance à l'OCR". */
export function nextSourceOnManualEdit(text: string): FieldSource {
  return text === '' ? null : 'manual';
}

/** Une valeur d'origine manuelle ne doit jamais être écrasée par une nouvelle proposition OCR. */
export function shouldApplyOcr(currentSource: FieldSource): boolean {
  return currentSource !== 'manual';
}

/**
 * Champ texte qui distingue une valeur d'origine OCR d'une valeur tapée/corrigée à la
 * main. Une nouvelle proposition OCR peut rafraîchir un champ vide ou encore au dernier
 * état "ocr" (même si ce dernier résultat était faux), mais ne touche jamais une valeur
 * que l'utilisateur a explicitement saisie.
 *
 * applyOcr() passe par une mise à jour fonctionnelle du state (`setSource(prev => ...)`)
 * plutôt que de lire `source` par fermeture : ça élimine toute la classe de bug où un
 * appel OCR lancé plus tôt (ex. sur une première photo ratée) se résout après un appel
 * plus récent et écrase la bonne valeur avec une capture figée de l'état — peu importe
 * l'ordre ou le délai de résolution des appels, la vérification porte toujours sur
 * l'état réellement courant au moment du traitement.
 */
export function useOcrTrackedField(initialValue = '') {
  const [value, setValue] = useState(initialValue);
  const [source, setSource] = useState<FieldSource>(null);

  const setManual = useCallback((text: string) => {
    setValue(text);
    setSource(nextSourceOnManualEdit(text));
  }, []);

  const applyOcr = useCallback((newValue: string) => {
    setSource((prevSource) => {
      if (!shouldApplyOcr(prevSource)) return prevSource;
      setValue(newValue);
      return 'ocr';
    });
  }, []);

  // Chargement d'une valeur existante (mode édition) : verrouillée comme une saisie
  // manuelle confirmée — une photo reprise ne doit pas l'écraser sans passer par un
  // champ vidé au préalable.
  const loadExisting = useCallback((text: string) => {
    setValue(text);
    setSource(text === '' ? null : 'manual');
  }, []);

  return { value, source, setManual, applyOcr, loadExisting } as const;
}
