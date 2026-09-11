import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listVehicles } from '@/src/features/vehicles/api';
import { listDrivers } from '@/src/features/drivers/api';
import {
  createFuelEvent,
  deleteFuelEvent,
  getFuelEvent,
  updateFuelEvent,
  uploadFuelEventPhoto,
} from '@/src/features/fuel-events/api';
import { PHOTO_TYPES, type FuelPhotoType } from '@/src/features/fuel-events/types';
import { PhotoSlot } from '@/src/components/PhotoSlot';
import type { Vehicle } from '@/src/features/vehicles/types';
import type { Driver } from '@/src/features/drivers/types';
import { supabase } from '@/src/lib/supabase';
import { ChipRow } from '@/src/components/ChipRow';
import { FormField } from '@/src/components/FormField';
import { ocrService } from '@/src/services/ocr';
import { checkKmConsistency } from '@/src/features/vehicles/kmConsistency';
import { useOcrTrackedField } from '@/src/hooks/useOcrTrackedField';

// Avertissement non bloquant si montant saisi ≠ litres × prix unitaire.
// Seuil relatif (pas un montant fixe en centimes) car le RWF n'a pas de sous-unité.
const AMOUNT_TOLERANCE_RATIO = 0.005; // 0.5 %
const AMOUNT_TOLERANCE_FLOOR_RWF = 5;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewFuelEventScreen() {
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
  const litersField = useOcrTrackedField();
  const unitPriceField = useOcrTrackedField();
  const amountField = useOcrTrackedField();
  const [station, setStation] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Partial<Record<FuelPhotoType, string>>>({});
  const [originalPhotoUrls, setOriginalPhotoUrls] = useState<Partial<Record<FuelPhotoType, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? 'Modifier le plein' : 'Nouveau plein' });
  }, [editingId, navigation]);

  useEffect(() => {
    (async () => {
      try {
        const [vehicleList, driverList, existing] = await Promise.all([
          listVehicles(),
          listDrivers(),
          editingId ? getFuelEvent(editingId) : Promise.resolve(null),
        ]);
        setVehicles(vehicleList);
        setDrivers(driverList);

        if (existing) {
          setVehicleId(existing.vehicle_id);
          setDriverId(existing.driver_id);
          setEventDate(existing.event_date);
          kmField.loadExisting(String(existing.km));
          litersField.loadExisting(String(existing.liters));
          unitPriceField.loadExisting(String(existing.unit_price));
          amountField.loadExisting(String(existing.amount));
          setStation(existing.station ?? '');
          setNotes(existing.notes ?? '');

          const loadedPhotos: Partial<Record<FuelPhotoType, string>> = {};
          for (const type of Object.keys(existing.photos) as FuelPhotoType[]) {
            loadedPhotos[type] = existing.photos[type]!.signedUrl;
          }
          setPhotos(loadedPhotos);
          setOriginalPhotoUrls(loadedPhotos);
        } else {
          setVehicleId((current) => current ?? vehicleList[0]?.id ?? null);
        }
      } catch (e) {
        console.error('[IntelliFleet][diag] erreur chargement véhicules/chauffeurs/plein :', e);
        setLoadError(e instanceof Error ? e.message : 'Erreur de chargement.');
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  const amountWarning = useMemo(() => {
    const l = parseFloat(litersField.value);
    const p = parseFloat(unitPriceField.value);
    const a = parseFloat(amountField.value);
    if (!l || !p || !a) return null;
    const expected = l * p;
    const diff = Math.abs(a - expected);
    const threshold = Math.max(AMOUNT_TOLERANCE_FLOOR_RWF, expected * AMOUNT_TOLERANCE_RATIO);
    if (diff > threshold) {
      return `Montant inhabituel : litres × prix ≈ ${Math.round(expected).toLocaleString('fr-FR')} RWF, saisi ${Math.round(a).toLocaleString('fr-FR')} RWF.`;
    }
    return null;
  }, [litersField.value, unitPriceField.value, amountField.value]);

  const kmWarning = useMemo(() => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return null;
    return checkKmConsistency(parseInt(kmField.value, 10), vehicle.current_km);
  }, [kmField.value, vehicleId, vehicles]);

  // Pré-remplissage OCR : n'écrase jamais une valeur saisie/corrigée à la main (voir
  // useOcrTrackedField). Uniquement sur les emplacements où le texte a un sens (compteur,
  // ticket) — véhicule+plaque et pompe ne déclenchent pas d'appel OCR.
  async function handlePhotoChange(type: FuelPhotoType, uri: string) {
    setPhotos((current) => ({ ...current, [type]: uri }));

    if (type !== 'odometer' && type !== 'receipt') return;
    try {
      const result = await ocrService.recognize(uri, type);
      if (type === 'odometer' && result.km !== undefined) {
        kmField.applyOcr(String(result.km));
      }
      if (type === 'receipt') {
        if (result.liters !== undefined) litersField.applyOcr(String(result.liters));
        if (result.unitPrice !== undefined) unitPriceField.applyOcr(String(result.unitPrice));
        if (result.amount !== undefined) amountField.applyOcr(String(result.amount));
      }
    } catch (e) {
      console.error('[IntelliFleet][diag] erreur OCR (plein) :', e);
    }
  }

  async function handleSubmit() {
    if (!vehicleId) {
      Alert.alert('Véhicule requis', 'Sélectionne un véhicule.');
      return;
    }
    const kmNum = parseInt(kmField.value, 10);
    const litersNum = parseFloat(litersField.value);
    const unitPriceNum = parseInt(unitPriceField.value, 10);
    const amountNum = parseInt(amountField.value, 10);
    if (!eventDate || Number.isNaN(kmNum) || Number.isNaN(litersNum) || Number.isNaN(unitPriceNum) || Number.isNaN(amountNum)) {
      Alert.alert('Champs incomplets', 'Vérifie la date, le km, les litres, le prix unitaire et le montant.');
      return;
    }

    setSubmitting(true);
    try {
      const input = {
        vehicleId,
        driverId,
        eventDate,
        km: kmNum,
        liters: litersNum,
        unitPrice: unitPriceNum,
        amount: amountNum,
        station: station.trim() || null,
        notes: notes.trim() || null,
      };
      const event = editingId ? await updateFuelEvent(editingId, input) : await createFuelEvent(input);

      const { data: userData } = await supabase.auth.getUser();
      const ownerId = userData.user?.id;
      if (ownerId) {
        for (const { type } of PHOTO_TYPES) {
          const uri = photos[type];
          // Ne réuploade que les emplacements réellement modifiés (nouvelle capture) —
          // une photo déjà en base et inchangée garde son URL signée d'origine.
          if (uri && uri !== originalPhotoUrls[type]) {
            await uploadFuelEventPhoto({ fuelEventId: event.id, ownerId, type, localUri: uri });
          }
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
    Alert.alert('Supprimer ce plein ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: confirmDelete },
    ]);
  }

  async function confirmDelete() {
    if (!editingId) return;
    setSubmitting(true);
    try {
      await deleteFuelEvent(editingId);
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
      <Text style={styles.sectionTitle}>Photos (optionnelles à la saisie)</Text>
      <View style={styles.photoGrid}>
        {PHOTO_TYPES.map(({ type, label }) => (
          <PhotoSlot
            key={type}
            label={label}
            uri={photos[type] ?? null}
            onChange={(uri) => handlePhotoChange(type, uri)}
          />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Véhicule</Text>
      <ChipRow items={vehicles.map((v) => ({ id: v.id, label: v.name }))} selectedId={vehicleId} onSelect={setVehicleId} />

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
      <FormField label="Litres" value={litersField.value} onChangeText={litersField.setManual} keyboardType="decimal-pad" />
      <FormField
        label="Prix unitaire (RWF/L)"
        value={unitPriceField.value}
        onChangeText={unitPriceField.setManual}
        keyboardType="numeric"
      />
      <FormField label="Montant (RWF)" value={amountField.value} onChangeText={amountField.setManual} keyboardType="numeric" />
      {amountWarning && <Text style={styles.warning}>{amountWarning}</Text>}
      <FormField label="Station" value={station} onChangeText={setStation} />
      <FormField label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.submitButtonText}>
          {submitting ? 'Enregistrement…' : editingId ? 'Enregistrer les modifications' : 'Enregistrer'}
        </Text>
      </Pressable>

      {editingId && (
        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={submitting}>
          <Text style={styles.deleteButtonText}>Supprimer ce plein</Text>
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
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  warning: { color: '#b45309', fontSize: 13, marginBottom: 8 },
  submitButton: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  submitButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  deleteButton: { borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#dc2626' },
  deleteButtonText: { color: '#dc2626', fontWeight: '700', fontSize: 16 },
});
