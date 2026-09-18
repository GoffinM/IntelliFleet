// Logique pure du tableau de bord d'analyse (admin only), sans dépendance DOM/Supabase —
// même esprit que km-consistency.js. app.js se charge du fetch (api.js) et du rendu ;
// ce module ne fait que transformer des données déjà chargées.
//
// Règle d'attribution (mois ET chauffeur) : les événements validés (fuel_events +
// logbook_entries) d'un véhicule sont triés chronologiquement ; chaque intervalle entre
// deux événements successifs forme un "segment" dont le km parcouru est
// curr.km - prev.km (jamais négatif — plafonné à 0 si une correction fait redescendre le
// km). Un segment appartient ENTIÈREMENT à l'événement qui l'ouvre (prev) : son mois et
// son chauffeur sont ceux de cet événement. Ainsi, pour un même véhicule/période, la
// somme du tableau mensuel et la somme du tableau par chauffeur coïncident toujours.

const MONTH_NAMES_FR = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

/** "2026-08-15" -> "2026-08". event_date est déjà une chaîne "YYYY-MM-DD" (colonne date
 *  Postgres) : découper la chaîne évite tout souci de fuseau horaire lié à Date. */
export function monthKey(eventDate) {
  return eventDate.slice(0, 7);
}

export function formatMonthLabel(month) {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${year}`;
}

/** Fusionne pleins + relevés d'UN véhicule en une seule chronologie triée. */
export function buildVehicleTimeline(vehicleId, fuelEvents, logbookEntries) {
  const events = [...fuelEvents, ...logbookEntries]
    .filter((e) => e.vehicle_id === vehicleId)
    .map((e) => ({
      date: e.event_date,
      createdAt: e.created_at,
      km: e.km,
      driverId: e.driver_id ?? null,
      driverName: e.driver_name ?? null,
    }));
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return events;
}

/** Une chronologie déjà triée -> ses segments (intervalles entre événements successifs). */
export function computeSegments(events) {
  const segments = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    segments.push({
      month: monthKey(prev.date),
      driverId: prev.driverId,
      driverName: prev.driverName,
      km: Math.max(0, curr.km - prev.km),
    });
  }
  return segments;
}

/** Km (segments) + litres/coût (fuel_events, indépendant des segments) groupés par mois.
 *  Un mois sans aucune des deux sources n'apparaît pas (pas de ligne "0" fabriquée). */
export function computeMonthlyStats(segments, fuelEvents) {
  const byMonth = new Map();
  const row = (month) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, km: 0, liters: 0, amount: 0 });
    return byMonth.get(month);
  };
  for (const seg of segments) {
    row(seg.month).km += seg.km;
  }
  for (const fe of fuelEvents) {
    const r = row(monthKey(fe.event_date));
    r.liters += fe.liters;
    r.amount += fe.amount;
  }
  return [...byMonth.values()]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((r) => ({
      ...r,
      costPerKm: r.km > 0 ? r.amount / r.km : null,
      litersPer100km: r.km > 0 ? (r.liters / r.km) * 100 : null,
    }));
}

/** Km attribué + nombre de segments par chauffeur. Les segments sans chauffeur (owner_id
 *  de l'événement d'ouverture non renseigné) sont regroupés dans une ligne "Non attribué"
 *  en fin de liste, uniquement si au moins un segment de ce type existe. */
export function computeDriverStats(segments) {
  const byDriver = new Map();
  for (const seg of segments) {
    const key = seg.driverId ?? '__unattributed__';
    if (!byDriver.has(key)) {
      byDriver.set(key, { driverId: seg.driverId, driverName: seg.driverName, km: 0, segmentCount: 0 });
    }
    const r = byDriver.get(key);
    r.km += seg.km;
    r.segmentCount += 1;
  }
  const rows = [...byDriver.values()];
  const attributed = rows.filter((r) => r.driverId != null).sort((a, b) => b.km - a.km);
  const unattributed = rows.find((r) => r.driverId == null);
  return unattributed ? [...attributed, { ...unattributed, driverName: 'Non attribué' }] : attributed;
}

/** Regroupe les véhicules par fleet_group (clé null = "sans groupe"). */
export function groupVehiclesByFleetGroup(vehicles) {
  const byGroup = new Map();
  for (const v of vehicles) {
    const key = v.fleet_group ?? null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(v.id);
  }
  return [...byGroup.entries()].map(([group, vehicleIds]) => ({ group, vehicleIds }));
}

/** Point d'entrée principal : agrège mensuel + chauffeurs pour un ensemble de véhicules
 *  (un seul véhicule, un groupe, ou toute la flotte — même fonction dans les 3 cas). */
export function buildScopeDashboard(vehicleIds, fuelEvents, logbookEntries) {
  const scopeSet = new Set(vehicleIds);
  const segments = vehicleIds.flatMap((vehicleId) =>
    computeSegments(buildVehicleTimeline(vehicleId, fuelEvents, logbookEntries))
  );
  const scopedFuelEvents = fuelEvents.filter((e) => scopeSet.has(e.vehicle_id));
  return {
    monthly: computeMonthlyStats(segments, scopedFuelEvents),
    drivers: computeDriverStats(segments),
  };
}
