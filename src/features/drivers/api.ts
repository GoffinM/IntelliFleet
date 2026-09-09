import { supabase } from '@/src/lib/supabase';
import type { Driver } from './types';

export async function listDrivers(): Promise<Driver[]> {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createDriver(name: string): Promise<Driver> {
  const { data, error } = await supabase.from('drivers').insert({ name }).select().single();
  if (error) throw error;
  return data;
}
