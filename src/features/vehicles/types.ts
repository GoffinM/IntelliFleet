export interface Vehicle {
  id: string;
  owner_id: string;
  name: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  initial_km: number;
  current_km: number;
  tank_capacity_liters: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewVehicleInput {
  name: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  initialKm: number;
  tankCapacityLiters: number | null;
}
