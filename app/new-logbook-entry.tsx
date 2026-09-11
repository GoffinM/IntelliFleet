import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listVehicles } from '@/src/features/vehicles/api';
import { listDrivers } from '@/src/features/drivers/api';
import {
  createLogbookEntry,
  deleteLogbookEntry,
  getLogbookEntry,
  updateLogbookEntry,
  uploadLogbookEntryPhoto,
} from '@/src/features/logbook/api';
import type { Vehicle } from '@/src/features/vehicles/types';
import type { Driver } from '@/src/features/drivers/types';
import { ChipRow } from '@/src/components/ChipRow';
import { FormField } from '@/src/components/FormField';
import { PhotoSlot } from '@/src/components/PhotoSlot';
import { ocrService } from '@/src/services/ocr';
import { supabase } from '@/src/lib/supabase';
import { checkKmConsistency } from '@/src/features/vehicles/kmConsistency';
import { useOcrTrackedField } from '@/src/hooks/useOcrTrackedField';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewLogbookEntryScreen() {
  const params = useLocalSearchParams<{ vehicleId?: string; id?: string }>();
  const editingId = params.id ?? null;
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState(todayIso());
  const kmField = useOcrTrackedField();
  const [comment, setComment] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? 'Modifier le relevé' : 'Nouveau relevé' });
  }, [editingId, navigation]);

  useEffect(() => {
    (async () => {
      try {
        const [vehicleList, driverList, existing] = await Promise.all([
          listVehicles(),
          listDrivers(),
          editingId ? getLogbookEntry(editingId) : Promise.resolve(null),
        ]);
        setVehicles(vehicleList);
        setDrivers(driverList);

        if (existing) {
          setVehicleId(existing.vehicle_id);
          setDriverId(existing.driver_id);
          setEventDate(existing.event_date);
          kmField.loadExisting(String(existing.km));
          setComment(existing.comment ?? '');
          setPhotoUri(existing.photoSignedUrl);
          setOriginalPhotoUrl(existing.photoSignedUrl);
        } else {
          setVehicleId((current) => current ?? vehicleList[0]?.id ?? null);
        }
      } catch (e) {
        console.error('[IntelliFleet][diag] erreur chargement véhicules/chauffeurs/relevé :', e);
        setLoadError(e instanceof Error ? e.message : 'Erreur de chargement.');
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  const kmWarning = useMemo(() => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return null;
    return checkKmConsistency(parseInt(kmField.value, 10), vehicle.current_km);
  }, [kmField.value, vehicleId, vehicles]);

  // Pré-remplissage OCR : n'écrase jamais une valeur saisie/corrigée à la main
  // (voir useOcrTrackedField).
  async function handlePhotoChange(uri: string) {
    setPhotoUri(uri);
    try {
      const result = await ocrService.recognize(uri, 'odometer');
      if (result.km !== undefined) {
        kmField.applyOcr(String(result.km));
      }
    } catch (e) {
      console.error('[IntelliFleet][diag] erreur OCR (relevé) :', e);
    }
  }

  async function handleSubmit() {
    if (!vehicleId) {
      Alert.alert('Véhicule requis', 'Sélectionne un véhicule.');
      return;
    }
    const kmNum = parseInt(kmField.value, 10);
    if (!eventDate || Number.isNaN(kmNum)) {
      Alert.alert('Champs incomplets', 'Vérifie la date et le km.');
      return;
    }

    setSubmitting(true);
    try {
      const input = {
        vehicleId,
        driverId,
        km: kmNum,
        eventDate,
        comment: comment.trim() || null,
      };
      const entry = editingId ? await updateLogbookEntry(editingId, input) : await createLogbookEntry(input);

      // Ne réuploade que si la photo a réellement changé (nouvelle capture) — inchangée,
      // elle garde son URL signée d'origine.
      if (photoUri && photoUri !== originalPhotoUrl) {
        const { data: userData } = await supabase.auth.getUser();
        const ownerId = userData.user?.id;
        if (ownerId) {
          await uploadLogbookEntryPhoto({ logbookEntryId: entry.id, ownerId, localUri: photoUri });
        }
      }

      router.replace(editingId ? '/history' : '/');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete() {
    if (!editingId) return;
    Alert.alert('Supprimer ce relevé ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: confirmDelete },
    ]);
  }

  async function confirmDelete() {
    if (!editingId) return;
    setSubmitting(true);
    try {
      await deleteLogbookEntry(editingId);
      router.replace('/history');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec de la suppression.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.warning}>Erreur au chargement : {loadError}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 60 + insets.bottom }]}>
      <Text style={styles.sectionTitle}>Photo (optionnelle)</Text>
      <PhotoSlot label="Compteur" uri={photoUri} onChange={handlePhotoChange} fullWidth />

      <Text style={styles.sectionTitle}>Véhicule</Text>
      <ChipRow
        items={vehicles.map((v) => ({ id: v.id, label: v.name }))}
        selectedId={vehicleId}
        onSelect={setVehicleId}
      />

      <Text style={styles.sectionTitle}>Chauffeur (optionnel)</Text>
      <ChipRow
        items={[{ id: '__none__', label: 'Aucun' }, ...drivers.map((d) => ({ id: d.id, label: d.name }))]}
        selectedId={driverId ?? '__none__'}
        onSelect={(id) => setDriverId(id === '__none__' ? null : id)}
      />

      <Text style={styles.sectionTitle}>Détails</Text>
      <FormField label="Date (AAAA-MM-JJ)" value={eventDate} onChangeText={setEventDate} />
      <FormField label="Km" value={kmField.value} onChangeText={kmField.setManual} keyboardType="numeric" />
      {kmWarning && <Text style={styles.warning}>{kmWarning}</Text>}
      <FormField label="Commentaire (optionnel)" value={comment} onChangeText={setComment} multiline />

      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.submitButtonText}>
          {submitting ? 'Enregistrement…' : editingId ? 'Enregistrer les modifications' : 'Enregistrer'}
        </Text>
      </Pressable>

      {editingId && (
        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={submitting}>
          <Text style={styles.deleteButtonText}>Supprimer ce relevé</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  warning: { color: '#b45309', fontSize: 13 },
  submitButton: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  submitButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  deleteButton: { borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#dc2626' },
  deleteButtonText: { color: '#dc2626', fontWeight: '700', fontSize: 16 },
});
