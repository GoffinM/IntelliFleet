import { useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  label: string;
  uri: string | null;
  onChange: (uri: string) => void;
  /** Occupe toute la largeur au lieu de la moitié (utile pour un emplacement photo unique). */
  fullWidth?: boolean;
}

// La caméra n'est pas disponible via expo-image-picker sur web (pas d'API navigateur
// équivalente branchée) — sur web on ne propose que la sélection de fichier.
const CAN_USE_CAMERA = Platform.OS !== 'web';

export function PhotoSlot({ label, uri, onChange, fullWidth }: Props) {
  const [busy, setBusy] = useState(false);

  async function pick(fromCamera: boolean) {
    setBusy(true);
    try {
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission refusée', 'Impossible d\'accéder à la caméra ou à la galerie.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
      if (!result.canceled && result.assets[0]) {
        onChange(result.assets[0].uri);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.slot, fullWidth && styles.slotFullWidth]}>
      <Text style={styles.label}>{label}</Text>
      {uri ? (
        <Image source={{ uri }} style={[styles.preview, fullWidth && styles.previewFullWidth]} />
      ) : (
        <View style={[styles.placeholder, fullWidth && styles.previewFullWidth]}>
          <Text style={styles.placeholderText}>Aucune photo</Text>
        </View>
      )}
      <View style={styles.actions}>
        {CAN_USE_CAMERA && (
          <Pressable style={styles.actionButton} onPress={() => pick(true)} disabled={busy}>
            <Text style={styles.actionText}>{uri ? 'Reprendre' : 'Prendre'}</Text>
          </Pressable>
        )}
        <Pressable style={styles.actionButton} onPress={() => pick(false)} disabled={busy}>
          <Text style={styles.actionText}>Galerie</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: '48%', gap: 6, marginBottom: 16 },
  slotFullWidth: { width: '100%' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  preview: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#e2e8f0' },
  previewFullWidth: { aspectRatio: 16 / 9 },
  placeholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: '#94a3b8', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 6 },
  actionButton: { flex: 1, backgroundColor: '#e2e8f0', borderRadius: 6, paddingVertical: 6, alignItems: 'center' },
  actionText: { fontSize: 12, fontWeight: '600', color: '#334155' },
});
