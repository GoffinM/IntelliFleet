import { Alert } from 'react-native';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { extractOdometerKm, extractReceiptFields } from './parse';
import type { OcrFields, OcrPhotoKind, OcrService } from './types';

export const ocrService: OcrService = {
  isAvailable: true,
  async recognize(localUri: string, kind: OcrPhotoKind): Promise<OcrFields> {
    try {
      const result = await TextRecognition.recognize(localUri);
      if (kind === 'odometer') {
        // DIAGNOSTIC TEMPORAIRE — à retirer une fois le souci d'extraction du km élucidé.
        // Volontairement PAS gardé derrière __DEV__ : le but est de voir ce texte sur le
        // terrain, dans un build preview (release JS, Metro déconnecté), pas seulement en dev.
        console.log('[IntelliFleet][ocr][diag] texte brut ML Kit (odometer) :', JSON.stringify(result.text));
        Alert.alert('OCR brut — compteur', result.text || '(texte vide)');
        const km = extractOdometerKm(result.text);
        return km === undefined ? {} : { km };
      }
      return extractReceiptFields(result.text);
    } catch (e) {
      // Best-effort : une erreur ML Kit (photo illisible, module non chargé...) ne doit
      // jamais bloquer la saisie manuelle qui reste toujours possible derrière.
      console.error('[IntelliFleet][ocr] erreur ML Kit :', e);
      return {};
    }
  },
};
