import type { OcrFields, OcrPhotoKind, OcrService } from './types';

// Pas d'OCR sur le web pour cette tranche — mode dégradé "saisie manuelle uniquement"
// assumé (pas un bug). Voir index.native.ts pour l'implémentation ML Kit réelle.
export const ocrService: OcrService = {
  isAvailable: false,
  async recognize(_localUri: string, _kind: OcrPhotoKind): Promise<OcrFields> {
    return {};
  },
};
