import { Stack } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSession } from '@/src/hooks/useSession';

export default function RootLayout() {
  const { loading } = useSession();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen name="index" options={{ title: 'IntelliFleet' }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="new-fuel-event" options={{ title: 'Nouveau plein' }} />
      <Stack.Screen name="new-logbook-entry" options={{ title: 'Nouveau relevé' }} />
      <Stack.Screen name="history" options={{ title: 'Historique' }} />
      <Stack.Screen name="add-vehicle" options={{ title: 'Ajouter un véhicule', presentation: 'modal' }} />
      <Stack.Screen name="add-driver" options={{ title: 'Ajouter un chauffeur', presentation: 'modal' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
