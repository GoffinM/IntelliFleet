import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listVehicles } from '@/src/features/vehicles/api';
import { listDrivers } from '@/src/features/drivers/api';
import { createFuelEvent, uploadFuelEventPhoto } from '@/src/features/fuel-events/api';
import { PHOTO_TYPES, type FuelPhotoType } from '@/src/features/fuel-events/types';
import { PhotoSlot } from '@/src/components/PhotoSlot';
import type { Vehicle } from '@/src/features/vehicles/types';
import type { Driver } from '@/src/features/drivers/types';
import { supabase } from '@/src/lib/supabase';
import { ChipRow } from '@/src/components/ChipRow';
import { FormField } from '@/src/components/FormField';

// Avertissement non bloquant si montant saisi ≠ litres × prix unitaire.
// Seuil relatif (pas un montant fixe en centimes) car le RWF n'a pas de sous-unité.
const AMOUNT_TOLERANCE_RATIO = 0.005; // 0.5 %
const AMOUNT_TOLERANCE_FLOOR_RWF = 5;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewFuelEventScreen() {
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState(todayIso());
  const [km, setKm] = useState('');
  const [liters, setLiters] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [station, setStation] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Partial<Record<FuelPhotoType, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [vehicleList, driverList] = await Promise.all([listVehicles(), listDrivers()]);
        setVehicles(vehicleList);
        setDrivers(driverList);
        setVehicleId((current) => current ?? vehicleList[0]?.id ?? null);
      } catch (e) {
        console.error('[IntelliFleet][diag] erreur chargement véhicules/chauffeurs :', e);
        setLoadError(e instanceof Error ? e.message : 'Erreur de chargement.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const amountWarning = useMemo(() => {
    const l = parseFloat(liters);
    const p = parseFloat(unitPrice);
    const a = parseFloat(amount);
    if (!l || !p || !a) return null;
    const expected = l * p;
    const diff = Math.abs(a - expected);
    const threshold = Math.max(AMOUNT_TOLERANCE_FLOOR_RWF, expected * AMOUNT_TOLERANCE_RATIO);
    if (diff > threshold) {
      return `Montant inhabituel : litres × prix ≈ ${Math.round(expected).toLocaleString('fr-FR')} RWF, saisi ${Math.round(a).toLocaleString('fr-FR')} RWF.`;
    }
    return null;
  }, [liters, unitPrice, amount]);

  async function handleSubmit() {
    if (!vehicleId) {
      Alert.alert('Véhicule requis', 'Sélectionne un véhicule.');
      return;
    }
    const kmNum = parseInt(km, 10);
    const litersNum = parseFloat(liters);
    const unitPriceNum = parseInt(unitPrice, 10);
    const amountNum = parseInt(amount, 10);
    if (!eventDate || Number.isNaN(kmNum) || Number.isNaN(litersNum) || Number.isNaN(unitPriceNum) || Number.isNaN(amountNum)) {
      Alert.alert('Champs incomplets', 'Vérifie la date, le km, les litres, le prix unitaire et le montant.');
      return;
    }

    setSubmitting(true);
    try {
      const event = await createFuelEvent({
        vehicleId,
        driverId,
        eventDate,
        km: kmNum,
        liters: litersNum,
        unitPrice: unitPriceNum,
        amount: amountNum,
        station: station.trim() || null,
        notes: notes.trim() || null,
      });

      const { data: userData } = await supabase.auth.getUser();
      const ownerId = userData.user?.id;
      if (ownerId) {
        for (const { type } of PHOTO_TYPES) {
          const uri = photos[type];
          if (uri) {
            await uploadFuelEventPhoto({ fuelEventId: event.id, ownerId, type, localUri: uri });
          }
        }
      }

      router.replace('/');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Échec de l'enregistrement.");
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
            onChange={(uri) => setPhotos((current) => ({ ...current, [type]: uri }))}
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
      <FormField label="Km" value={km} onChangeText={setKm} keyboardType="numeric" />
      <FormField label="Litres" value={liters} onChangeText={setLiters} keyboardType="decimal-pad" />
      <FormField label="Prix unitaire (RWF/L)" value={unitPrice} onChangeText={setUnitPrice} keyboardType="numeric" />
      <FormField label="Montant (RWF)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      {amountWarning && <Text style={styles.warning}>{amountWarning}</Text>}
      <FormField label="Station" value={station} onChangeText={setStation} />
      <FormField label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.submitButtonText}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</Text>
      </Pressable>
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
});
