export type FuelPhotoType = 'vehicle_plate' | 'odometer' | 'pump' | 'receipt';

export const PHOTO_TYPES: ReadonlyArray<{ type: FuelPhotoType; label: string }> = [
  { type: 'vehicle_plate', label: 'Véhicule + plaque' },
  { type: 'odometer', label: 'Compteur' },
  { type: 'pump', label: 'Pompe' },
  { type: 'receipt', label: 'Ticket' },
];

export interface FuelEvent {
  id: string;
  owner_id: string;
  vehicle_id: string;
  driver_id: string | null;
  event_date: string; // format AAAA-MM-JJ
  km: number;
  liters: number;
  unit_price: number; // RWF/L, entier
  amount: number; // RWF, entier
  station: string | null;
  notes: string | null;
  is_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  fuel_event_id: string;
  type: FuelPhotoType;
  storage_path: string;
  created_at: string;
}

export interface NewFuelEventInput {
  vehicleId: string;
  driverId: string | null;
  eventDate: string;
  km: number;
  liters: number;
  unitPrice: number;
  amount: number;
  station: string | null;
  notes: string | null;
}
