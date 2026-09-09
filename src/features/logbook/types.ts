export interface LogbookEntry {
  id: string;
  owner_id: string;
  vehicle_id: string;
  driver_id: string | null;
  km: number;
  event_date: string; // format AAAA-MM-JJ
  comment: string | null;
  photo_storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewLogbookEntryInput {
  vehicleId: string;
  driverId: string | null;
  km: number;
  eventDate: string;
  comment: string | null;
}
