import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveVehicleId } from '@/src/hooks/useActiveVehicleId';
import { listVehicles } from '@/src/features/vehicles/api';
import { listFuelEvents, type LastFuelEvent } from '@/src/features/fuel-events/api';
import { listLogbookEntries, type LogbookEntryWithDriver } from '@/src/features/logbook/api';
import type { Vehicle } from '@/src/features/vehicles/types';
import { ChipRow } from '@/src/components/ChipRow';

// Historique fusionné : une seule timeline par véhicule, pleins et relevés
// mélangés par date, distingués par une puce de couleur (bleu = plein, gris = relevé).
type TimelineItem =
  | {
      kind: 'fuel';
      id: string;
      date: string;
      createdAt: string;
      km: number;
      driverName: string | null;
      liters: number;
      amount: number;
      station: string | null;
      isComplete: boolean;
    }
  | {
      kind: 'logbook';
      id: string;
      date: string;
      createdAt: string;
      km: number;
      driverName: string | null;
      comment: string | null;
      hasPhoto: boolean;
    };

function toTimeline(fuelEvents: LastFuelEvent[], logbookEntries: LogbookEntryWithDriver[]): TimelineItem[] {
  const fuelItems: TimelineItem[] = fuelEvents.map((e) => ({
    kind: 'fuel',
    id: e.id,
    date: e.event_date,
    createdAt: e.created_at,
    km: e.km,
    driverName: e.driver_name,
    liters: e.liters,
    amount: e.amount,
    station: e.station,
    isComplete: e.is_complete,
  }));
  const logbookItems: TimelineItem[] = logbookEntries.map((e) => ({
    kind: 'logbook',
    id: e.id,
    date: e.event_date,
    createdAt: e.created_at,
    km: e.km,
    driverName: e.driver_name,
    comment: e.comment,
    hasPhoto: e.photo_storage_path !== null,
  }));
  return [...fuelItems, ...logbookItems].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeVehicleId, setActiveVehicleId, loaded: vehicleIdLoaded } = useActiveVehicleId();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listVehicles();
      setVehicles(list);

      const stillValid = activeVehicleId && list.some((v) => v.id === activeVehicleId);
      const selected = stillValid ? activeVehicleId : (list[0]?.id ?? null);
      if (selected && selected !== activeVehicleId) setActiveVehicleId(selected);

      if (selected) {
        const [fuelEvents, logbookEntries] = await Promise.all([
          listFuelEvents(selected),
          listLogbookEntries(selected),
        ]);
        setItems(toTimeline(fuelEvents, logbookEntries));
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error('[IntelliFleet][diag] erreur chargement historique :', e);
      setError(e instanceof Error ? e.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!vehicleIdLoaded || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 60 + insets.bottom }]}>
      <ChipRow
        items={vehicles.map((v) => ({ id: v.id, label: v.name }))}
        selectedId={activeVehicleId}
        onSelect={setActiveVehicleId}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {items.length === 0 && !error && (
        <Text style={styles.emptyText}>Aucun événement enregistré pour ce véhicule.</Text>
      )}

      {items.map((item) => (
        <Pressable
          key={`${item.kind}-${item.id}`}
          style={styles.row}
          onPress={() =>
            router.push(
              item.kind === 'fuel'
                ? { pathname: '/new-fuel-event', params: { id: item.id } }
                : { pathname: '/new-logbook-entry', params: { id: item.id } }
            )
          }
        >
          <View style={[styles.dot, item.kind === 'fuel' ? styles.dotFuel : styles.dotLogbook]} />
          <View style={styles.rowContent}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.kind === 'fuel' ? 'Plein' : 'Relevé'}</Text>
              <Text style={styles.rowDate}>{item.date}</Text>
            </View>
            <Text style={styles.rowLine}>{item.km.toLocaleString('fr-FR')} km</Text>
            {item.kind === 'fuel' && (
              <>
                <Text style={styles.rowLine}>
                  {item.liters} L · {item.amount.toLocaleString('fr-FR')} RWF
                </Text>
                {item.station && <Text style={styles.rowLine}>{item.station}</Text>}
                {!item.isComplete && <Text style={styles.incompleteTag}>Photos incomplètes</Text>}
              </>
            )}
            {item.kind === 'logbook' && (
              <>
                {item.comment && <Text style={styles.rowLine}>{item.comment}</Text>}
                {!item.hasPhoto && <Text style={styles.incompleteTag}>Sans photo</Text>}
              </>
            )}
            {item.driverName && <Text style={styles.rowLine}>Chauffeur : {item.driverName}</Text>}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#dc2626' },
  emptyText: { color: '#64748b', fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  dotFuel: { backgroundColor: '#2563eb' },
  dotLogbook: { backgroundColor: '#94a3b8' },
  rowContent: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, gap: 4 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  rowTitle: { fontWeight: '700', color: '#1e293b' },
  rowDate: { color: '#64748b', fontSize: 13 },
  rowLine: { fontSize: 14, color: '#334155' },
  incompleteTag: { color: '#b45309', fontWeight: '600', fontSize: 13 },
});
