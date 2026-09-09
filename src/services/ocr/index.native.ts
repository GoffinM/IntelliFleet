import type { OcrFields, OcrService } from './types';

// Scaffolding pour une prochaine itération : brancher @react-native-ml-kit/text-recognition
// ici (nécessite expo-dev-client + build EAS, incompatible Expo Go). Non câblé au formulaire
// pour ce vertical slice — validé volontairement hors périmètre.
export const ocrService: OcrService = {
  isAvailable: false,
  async recognize(_localUri: string): Promise<OcrFields> {
    return {};
  },
};
