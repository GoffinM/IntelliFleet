import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/src/hooks/useSession';
import { useActiveVehicleId } from '@/src/hooks/useActiveVehicleId';
import { listVehicles } from '@/src/features/vehicles/api';
import { getLastFuelEvent, type LastFuelEvent } from '@/src/features/fuel-events/api';
import type { Vehicle } from '@/src/features/vehicles/types';
import { supabase } from '@/src/lib/supabase';
import { ChipRow } from '@/src/components/ChipRow';

export default function HomeScreen() {
  const { session, loading: sessionLoading } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeVehicleId, setActiveVehicleId, loaded: vehicleIdLoaded } = useActiveVehicleId();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [lastEvent, setLastEvent] = useState<LastFuelEvent | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // DIAGNOSTIC (temporaire) : identité de la session active, à comparer avec l'owner_id
  // attendu en base. Visible dans les logs Metro à chaque (re)montage de l'écran.
  useEffect(() => {
    console.log('[IntelliFleet][diag] session user id =', session?.user?.id ?? '(aucune session)');
    console.log('[IntelliFleet][diag] session user email =', session?.user?.email ?? '(aucune session)');
  }, [session]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoadingData(true);
    setError(null);
    try {
      const list = await listVehicles();
      console.log('[IntelliFleet][diag] listVehicles() a renvoyé', list.length, 'véhicule(s) pour user', session.user.id);
      setVehicles(list);

      const stillValid = activeVehicleId && list.some((v) => v.id === activeVehicleId);
      const selected = stillValid ? activeVehicleId : (list[0]?.id ?? null);
      if (selected && selected !== activeVehicleId) setActiveVehicleId(selected);

      setLastEvent(selected ? await getLastFuelEvent(selected) : null);
    } catch (e) {
      console.error('[IntelliFleet][diag] erreur load() accueil :', e);
      setError(e instanceof Error ? e.message : 'Erreur de chargement.');
    } finally {
      setLoadingData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeVehicleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSignOut() {
    console.log('[IntelliFleet][diag] déconnexion demandée, session avant :', session?.user?.id);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error('[IntelliFleet][diag] erreur signOut :', signOutError);
    }
    // signOut() vide aussi la session persistée dans AsyncStorage (storage configuré
    // dans src/lib/supabase.ts) — le prochain getSession() renverra null.
  }

  if (!sessionLoading && !session) {
    return <Redirect href="/login" />;
  }

  if (sessionLoading || !vehicleIdLoaded || loadingData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;

  return (
    <View style={[styles.container, { paddingBottom: 20 + insets.bottom }]}>
      {/* Bandeau diagnostic temporaire — à retirer une fois le souci de session résolu */}
      <View style={styles.debugBanner}>
        <Text style={styles.debugText}>session uid : {session?.user?.id ?? '(aucune)'}</Text>
        <Text style={styles.debugText}>session email : {session?.user?.email ?? '(aucune)'}</Text>
        <Pressable onPress={handleSignOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Se déconnecter</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Véhicule actif</Text>
      <ChipRow
        items={vehicles.map((v) => ({ id: v.id, label: v.name }))}
        selectedId={activeVehicleId}
        onSelect={setActiveVehicleId}
      />
      {vehicles.length === 0 && !error && (
        <Text style={styles.lastEventLine}>
          Aucun véhicule renvoyé pour cette session (0 ligne, pas d'erreur — probablement un souci de droits/session, pas de connexion).
        </Text>
      )}

      <View style={styles.linkRow}>
        <Pressable onPress={() => router.push('/add-vehicle')}>
          <Text style={styles.linkText}>+ Véhicule</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/add-driver')}>
          <Text style={styles.linkText}>+ Chauffeur</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/history')}>
          <Text style={styles.linkText}>Historique →</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {activeVehicle && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{activeVehicle.name}</Text>
          <Text style={styles.cardSubtitle}>
            {activeVehicle.plate} · {activeVehicle.current_km.toLocaleString('fr-FR')} km
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>Dernier plein</Text>
          {lastEvent ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.lastEventLine}>
                {lastEvent.event_date} — {lastEvent.km.toLocaleString('fr-FR')} km
              </Text>
              <Text style={styles.lastEventLine}>
                {lastEvent.liters} L · {lastEvent.amount.toLocaleString('fr-FR')} RWF
              </Text>
              {lastEvent.station && <Text style={styles.lastEventLine}>{lastEvent.station}</Text>}
              {lastEvent.driver_name && <Text style={styles.lastEventLine}>Chauffeur : {lastEvent.driver_name}</Text>}
              {!lastEvent.is_complete && <Text style={styles.incompleteTag}>Photos incomplètes</Text>}
            </View>
          ) : (
            <Text style={styles.lastEventLine}>Aucun plein enregistré pour ce véhicule.</Text>
          )}
        </View>
      )}

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.newButton, !activeVehicle && styles.newButtonDisabled]}
          onPress={() =>
            activeVehicle &&
            router.push({ pathname: '/new-fuel-event', params: { vehicleId: activeVehicle.id } })
          }
          disabled={!activeVehicle}
        >
          <Text style={styles.newButtonText}>Nouveau plein</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, !activeVehicle && styles.newButtonDisabled]}
          onPress={() =>
            activeVehicle &&
            router.push({ pathname: '/new-logbook-entry', params: { vehicleId: activeVehicle.id } })
          }
          disabled={!activeVehicle}
        >
          <Text style={styles.secondaryButtonText}>Nouveau relevé</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' },
  linkRow: { flexDirection: 'row', gap: 20 },
  linkText: { color: '#2563eb', fontWeight: '600', fontSize: 13 },
  card: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { fontSize: 20, fontWeight: '700' },
  cardSubtitle: { color: '#64748b' },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 4 },
  lastEventLine: { fontSize: 15, color: '#1e293b' },
  incompleteTag: { color: '#b45309', fontWeight: '600', marginTop: 4 },
  error: { color: '#dc2626' },
  debugBanner: {
    backgroundColor: '#fef9c3',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  debugText: { fontSize: 11, color: '#713f12', fontFamily: 'monospace' },
  signOutButton: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#dc2626', borderRadius: 6 },
  signOutText: { color: 'white', fontSize: 12, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  newButton: { flex: 1, backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center' },
  newButtonDisabled: { opacity: 0.5 },
  newButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  secondaryButtonText: { color: '#2563eb', fontWeight: '700', fontSize: 16 },
});
