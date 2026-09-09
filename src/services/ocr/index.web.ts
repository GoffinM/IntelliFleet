import type { OcrFields, OcrService } from './types';

// Pas d'OCR sur le web pour cette tranche — mode dégradé "saisie manuelle uniquement"
// assumé (pas un bug). Voir index.native.ts pour l'équivalent Android.
export const ocrService: OcrService = {
  isAvailable: false,
  async recognize(_localUri: string): Promise<OcrFields> {
    return {};
  },
};
