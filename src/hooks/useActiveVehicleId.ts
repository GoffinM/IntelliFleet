import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'intellifleet:active_vehicle_id';

/** Mémorise localement (par appareil) le véhicule sélectionné comme "actif" sur l'accueil. */
export function useActiveVehicleId() {
  const [activeVehicleId, setActiveVehicleIdState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setActiveVehicleIdState(value))
      .finally(() => setLoaded(true));
  }, []);

  const setActiveVehicleId = useCallback((id: string) => {
    setActiveVehicleIdState(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {
      // non bloquant : la sélection reste valide pour la session en cours même si la persistance échoue
    });
  }, []);

  return { activeVehicleId, setActiveVehicleId, loaded };
}
