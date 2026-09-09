export interface OcrFields {
  km?: number;
  liters?: number;
  unitPrice?: number;
  amount?: number;
}

export interface OcrService {
  isAvailable: boolean;
  recognize(localUri: string): Promise<OcrFields>;
}
