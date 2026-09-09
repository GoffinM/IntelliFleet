import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { createDriver } from '@/src/features/drivers/api';
import { FormField } from '@/src/components/FormField';

export default function AddDriverScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert('Nom requis', 'Saisis le nom du chauffeur.');
      return;
    }
    setSubmitting(true);
    try {
      await createDriver(name.trim());
      router.back();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <FormField label="Nom" value={name} onChangeText={setName} />
      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.submitButtonText}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  submitButton: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  submitButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
