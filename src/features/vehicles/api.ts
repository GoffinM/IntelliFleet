import { supabase } from '@/src/lib/supabase';
import type { NewVehicleInput, Vehicle } from './types';

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createVehicle(input: NewVehicleInput): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      name: input.name,
      plate: input.plate,
      make: input.make,
      model: input.model,
      year: input.year,
      initial_km: input.initialKm,
      tank_capacity_liters: input.tankCapacityLiters,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
