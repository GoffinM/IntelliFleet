// Repli pour la résolution de modules "Node" classique (tsc, outils de test...).
// Metro, lui, résout toujours index.native.ts (iOS/Android) ou index.web.ts en priorité
// sur ce fichier pour les plateformes du projet — ce repli n'est jamais réellement chargé
// au runtime de l'app, il sert uniquement à ce que `@/src/services/ocr` soit un module
// valide pour tsc et pour d'éventuels outils qui ne connaissent pas les extensions Metro.
export * from './types';
export { ocrService } from './index.native';
