import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createVehicle } from '@/src/features/vehicles/api';
import { FormField } from '@/src/components/FormField';

export default function AddVehicleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [initialKm, setInitialKm] = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const initialKmNum = parseInt(initialKm, 10);
    if (!name.trim() || !plate.trim() || !make.trim() || !model.trim() || Number.isNaN(initialKmNum)) {
      Alert.alert('Champs incomplets', 'Nom, plaque, marque, modèle et km initial sont requis.');
      return;
    }

    setSubmitting(true);
    try {
      await createVehicle({
        name: name.trim(),
        plate: plate.trim(),
        make: make.trim(),
        model: model.trim(),
        year: year.trim() ? parseInt(year, 10) : null,
        initialKm: initialKmNum,
        tankCapacityLiters: tankCapacity.trim() ? parseFloat(tankCapacity) : null,
      });
      router.back();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 60 + insets.bottom }]}>
      <FormField label="Nom" value={name} onChangeText={setName} />
      <FormField label="Plaque" value={plate} onChangeText={setPlate} />
      <FormField label="Marque" value={make} onChangeText={setMake} />
      <FormField label="Modèle" value={model} onChangeText={setModel} />
      <FormField label="Année" value={year} onChangeText={setYear} keyboardType="numeric" />
      <FormField label="Km initial" value={initialKm} onChangeText={setInitialKm} keyboardType="numeric" />
      <FormField
        label="Capacité réservoir en litres (optionnel)"
        value={tankCapacity}
        onChangeText={setTankCapacity}
        keyboardType="decimal-pad"
      />
      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.submitButtonText}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  submitButton: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  submitButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
