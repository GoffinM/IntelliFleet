// IntelliFleet PWA — routing (hash) + 4 écrans, vanilla JS, sans framework.
import { supabase } from './supabase-client.js?v=202609251140';
import { checkKmConsistency } from './km-consistency.js?v=202609251140';
import {
  PHOTO_TYPES,
  listVehicles,
  listDrivers,
  createVehicle,
  createDriver,
  getMyProfile,
  getLastFuelEvent,
  listFuelEvents,
  createFuelEvent,
  updateFuelEvent,
  getFuelEvent,
  uploadFuelEventPhoto,
  deleteFuelEvent,
  listLogbookEntries,
  createLogbookEntry,
  updateLogbookEntry,
  getLogbookEntry,
  uploadLogbookEntryPhoto,
  deleteLogbookEntry,
  listUnvalidatedFuelEvents,
  listUnvalidatedLogbookEntries,
  listRecentlyValidatedFuelEvents,
  listRecentlyValidatedLogbookEntries,
  validateFuelEvent,
  validateLogbookEntry,
  deleteFuelEventPhotos,
  deleteLogbookEntryPhoto,
  countUnvalidatedEntries,
  listValidatedFuelEventsAll,
  listValidatedLogbookEntriesAll,
  listMyOpenLogbookTrips,
  countMyOpenLogbookTrips,
  listOpenTripsOnVehicleByOthers,
  analyzeOdometerPhoto,
  saveFuelEventOcrResult,
  saveLogbookEntryOcrResult,
  createBugReport,
} from './api.js?v=202609251140';
import { buildScopeDashboard, groupVehiclesByFleetGroup, formatMonthLabel, scopeCurrency } from './dashboard.js?v=202609251140';

const ACTIVE_VEHICLE_KEY = 'intellifleet:active_vehicle_id';
// Vocabulaire fermé, identique au check SQL (0012_fleet_group_access.sql) : un
// chauffeur ne voit que les véhicules des groupes qui lui sont accordés, un véhicule
// sans groupe n'est visible que par l'admin.
const FLEET_GROUPS = ['SHER Rwanda', 'SHER Burundi', 'Privés'];
const OCR_KM_TOLERANCE = 20; // km, écart absolu toléré entre la lecture Claude Vision et le km saisi
const OCR_CONCURRENCY = 2; // appels analyze-odometer simultanés max (pas 10 d'un coup)

// ---------- Helpers génériques ----------

/** Exécute worker(item) sur chaque élément de items, au plus `limit` en parallèle
 *  à tout instant (jamais tout d'un coup). Chaque appel est indépendant : un
 *  worker qui échoue n'arrête pas les autres tant que worker() gère ses propres
 *  erreurs (voir autoOcrItem dans renderValidation). */
async function runWithConcurrencyLimit(items, limit, worker) {
  let nextIndex = 0;
  async function runNext() {
    const i = nextIndex++;
    if (i >= items.length) return;
    await worker(items[i]);
    await runNext();
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runNext));
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Export CSV (Tableau de bord) ----------

/** Échappement CSV standard : entoure de guillemets et double les guillemets
 *  internes dès qu'une virgule, un guillemet ou un retour à la ligne est présent
 *  (typiquement un commentaire ou un nom de station libre). */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Déclenche un téléchargement 100% navigateur (Blob + lien temporaire), sans
 *  librairie. BOM UTF-8 en tête pour qu'Excel affiche correctement les accents. */
function downloadCsv(content, filename) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Clôture de trajet (0007_logbook_close.sql) ----------

/** ISO ("2026-09-05T14:30:00.000Z") -> valeur d'un input datetime-local, en heure
 *  locale du navigateur ("2026-09-05T16:30" en UTC+2 par ex.). */
function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Info non bloquante sur l'écran d'édition (0009_ocr_odometer.sql) : signale un
 *  écart entre la lecture Claude Vision et le km saisi. Rien si pas encore
 *  analysé, ou si l'écart est dans la tolérance (même seuil que l'écran
 *  Validation) — pas de bruit inutile quand tout concorde. */
function computeOcrKmInfo(km, ocrKm, ocrAnalyzedAt) {
  if (!ocrAnalyzedAt || ocrKm == null) return null;
  const k = parseInt(km, 10);
  if (Number.isNaN(k)) return null;
  if (Math.abs(ocrKm - k) <= OCR_KM_TOLERANCE) return null;
  return `Claude Vision a lu ${ocrKm.toLocaleString('fr-FR')} km sur la photo.`;
}

/** Avertissement non bloquant, même esprit que checkKmConsistency : le km de
 *  clôture ne devrait jamais être inférieur au km de départ du même relevé. */
function computeCloseKmWarning(km, closeKm) {
  const k = parseInt(km, 10);
  const ck = parseInt(closeKm, 10);
  if (!closeKm || Number.isNaN(k) || Number.isNaN(ck)) return null;
  if (ck < k) return `Km de clôture inférieur au km de départ (${k.toLocaleString('fr-FR')} km).`;
  return null;
}

function setContent(html) {
  document.getElementById('app').innerHTML = html;
}

function setLoading() {
  setContent('<div class="center"><div class="spinner"></div></div>');
}

function setError(e) {
  console.error('[IntelliFleet]', e);
  setContent(`<div class="center"><p class="error">${escapeHtml(e?.message || String(e))}</p></div>`);
}

function getActiveVehicleId(vehicles) {
  const stored = localStorage.getItem(ACTIVE_VEHICLE_KEY);
  if (stored && vehicles.some((v) => v.id === stored)) return stored;
  const fallback = vehicles[0]?.id ?? null;
  if (fallback) localStorage.setItem(ACTIVE_VEHICLE_KEY, fallback);
  return fallback;
}

function setActiveVehicleId(id) {
  localStorage.setItem(ACTIVE_VEHICLE_KEY, id);
}

/**
 * Prix unitaire (devise du véhicule par litre, entier) dérivé du montant et des litres — plus jamais saisi
 * à la main : seuls litres et montant figurent sur la pompe/le ticket. null si l'un
 * des deux manque ou si le résultat ne serait pas un prix valide (unit_price > 0).
 */
function computeUnitPrice(liters, amount) {
  const l = parseFloat(liters);
  const a = parseInt(amount, 10);
  if (!(l > 0) || !(a > 0)) return null;
  const price = Math.round(a / l);
  return price >= 1 ? price : null;
}

/** Devise d'un véhicule (0011_vehicle_currency.sql). Repli sur 'RWF' si la colonne
 *  est absente (migration pas encore passée) — même valeur que le défaut SQL. */
function vehicleCurrency(vehicle) {
  return vehicle?.currency ?? 'RWF';
}

/** "12 500 BIF" — un montant n'est jamais affiché sans sa devise. */
function formatAmount(amount, currency) {
  return `${Math.round(amount).toLocaleString('fr-FR')} ${currency}`;
}

function vehicleChipsHtml(vehicles, activeId) {
  return vehicles
    .map((v) => `<button class="chip ${v.id === activeId ? 'active' : ''}" data-id="${v.id}">${escapeHtml(v.name)}</button>`)
    .join('');
}

// Barre de navigation sticky (retour terrain : éviter d'avoir à redescendre tout en
// bas de l'écran pour revenir à l'accueil). Toujours un enfant direct de #app, JAMAIS
// à l'intérieur d'un wrapper screen-narrow/wide/dashboard/home — ces derniers peuvent
// devenir une "carte" avec son propre padding/radius sur desktop, ce qui casserait
// visuellement une barre sticky posée à l'intérieur.
const ROLE_LABELS = { admin: 'administrateur', driver: 'chauffeur' };

/** "Connecté : Mireille (chauffeur)" — identité visible sur chaque écran (captures,
 *  exports). Rien tant que le profil charge (undefined) ou s'il est absent (null),
 *  et jamais le rôle technique brut ("driver"/"admin"). */
function identityLineHtml() {
  if (!currentProfile) return '';
  const role = ROLE_LABELS[currentProfile.role];
  const name = currentProfile.display_name?.trim();
  if (!name && !role) return '';
  const text = name && role ? `${name} (${role})` : name || role;
  return `<span class="top-bar-identity">Connecté : ${escapeHtml(text)}</span>`;
}

function topBarHtml(title, { showBack = true } = {}) {
  // Capture du hash courant AU RENDU (pas au clic) : topBarHtml() est rappelée par
  // chaque renderXXX() à chaque changement de route, donc location.hash ici est
  // toujours exactement le hash de l'écran affiché — pas besoin d'un gestionnaire de
  // clic séparé pour "capturer" quoi que ce soit. Pas de lien vers soi-même depuis
  // l'écran de signalement lui-même (ça n'aurait pas de sens).
  const currentHash = location.hash.slice(1) || '/';
  const reportLink = currentHash.startsWith('/report-bug')
    ? ''
    : `<a href="#/report-bug?from=${encodeURIComponent(currentHash)}" class="top-bar-report">Signaler un problème</a>`;
  return `
    <div class="top-bar">
      ${showBack ? '<a href="#/" class="top-bar-back">← Accueil</a>' : ''}
      <h1 class="top-bar-title">${escapeHtml(title)}</h1>
      ${reportLink}
      ${identityLineHtml()}
    </div>
  `;
}

// ---------- Routing ----------

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  return { segments, query };
}

// Clé du dernier écran pleinement construit (statut de connexion + hash). route()
// peut être rappelée pour de multiples raisons sans rapport avec une vraie navigation
// (ex. supabase-js réémet des événements d'auth au retour de visibilité de l'onglet)
// — la correction se fait ici, à la source, une fois pour toutes : si ni le hash ni
// le statut de connexion n'ont réellement changé, on ne reconstruit rien, plutôt que
// de traquer chaque déclencheur individuel au cas par cas.
//
// Le contrôle se fait APRÈS la logique de redirection (pas avant) : le statut de
// connexion fait partie de la clé précisément pour que la transition login -> accueil
// (où le hash reste "#/login" jusqu'à ce que la redirection elle-même le change) ne
// soit jamais bloquée par ce garde-fou.
let lastRenderedKey;

// Profil (role admin/driver) de l'utilisateur connecté — voir 0005_fleet_multi_user.sql.
// undefined = pas encore chargé pour la session en cours ; null = chargé, aucune ligne
// profiles trouvée (compte non configuré) ; objet = profil chargé. Chargé une seule
// fois par connexion (pas à chaque hashchange) et réinitialisé à la déconnexion, voir
// onAuthStateChange plus bas.
let currentProfile;

const ADMIN_ONLY_PAGES = ['vehicle-form', 'driver-form', 'validation'];

async function route() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const { segments, query } = parseHash();
  const page = segments[0];

  if (!session && page !== 'login') {
    location.hash = '#/login';
    return;
  }
  if (session && page === 'login') {
    location.hash = '#/';
    return;
  }

  if (session && currentProfile === undefined) {
    currentProfile = await getMyProfile(session.user.id);
  }

  // Garde-fou d'affichage pour les écrans admin only : la vraie protection est la
  // policy RLS (insert/update/delete refusés côté serveur pour un non-admin), ceci
  // évite juste d'afficher l'écran à un compte driver qui taperait l'URL à la main.
  if (session && currentProfile && ADMIN_ONLY_PAGES.includes(page) && currentProfile.role !== 'admin') {
    location.hash = '#/';
    return;
  }

  const key = `${session ? 'in' : 'out'}:${location.hash}`;
  if (key === lastRenderedKey) return; // même écran déjà affiché, rien à refaire
  lastRenderedKey = key;

  try {
    if (session && currentProfile === null) return renderNoProfile();
    if (page === 'login') return renderLogin();
    if (page === 'history') return await renderHistory();
    if (page === 'fuel-event') return await renderFuelEventForm(segments[1] ?? null, query.get('vehicleId'));
    if (page === 'logbook-entry') return await renderLogbookEntryForm(segments[1] ?? null, query.get('vehicleId'));
    if (page === 'vehicle-form') return await renderVehicleForm();
    if (page === 'driver-form') return await renderDriverForm();
    if (page === 'validation') return await renderValidation();
    if (page === 'close-trip') return await renderCloseTrip();
    if (page === 'report-bug') return await renderReportBug(query.get('from'));
    return await renderHome();
  } catch (e) {
    setError(e);
  }
}

window.addEventListener('hashchange', route);

// Un re-render déclenché par route() est maintenant sans risque (les écrans se
// redessinent depuis leur état en mémoire, y compris les photos — voir
// renderFuelEventForm/renderLogbookEntryForm) : pas besoin de filtrage complexe sur
// l'identité de l'utilisateur. On ignore juste INITIAL_SESSION (déjà géré par l'appel
// explicite route() au démarrage) et TOKEN_REFRESHED (rafraîchissement silencieux du
// jeton, aucun effet sur le routing) pour éviter du travail inutile.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  if (event === 'SIGNED_OUT') currentProfile = undefined;
  route();
});

// ---------- Écran : login ----------

function renderLogin() {
  setContent(`
    <div style="margin-top:15vh">
      <h1 style="text-align:center;margin-bottom:24px">IntelliFleet</h1>
      <div class="field">
        <label>Email</label>
        <input type="email" id="login-email" autocomplete="username" autocapitalize="none">
      </div>
      <div class="field">
        <label>Mot de passe</label>
        <input type="password" id="login-password" autocomplete="current-password">
      </div>
      <p class="error" id="login-error" hidden></p>
      <button class="btn btn-primary" id="login-submit" style="width:100%">Se connecter</button>
    </div>
  `);

  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  submitBtn.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connexion…';
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
      // succès -> onAuthStateChange déclenche route() automatiquement
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Se connecter';
    }
  });
}

// ---------- Écran : compte non configuré ----------

// Un utilisateur peut avoir une session Supabase Auth valide sans ligne profiles
// (ex. compte créé mais pas encore assigné par l'admin) — depuis 0005, presque tout
// est bloqué par RLS pour ce cas (is_fleet_member() est faux), donc mieux vaut le
// dire clairement plutôt que d'afficher des écrans vides sans explication.
function renderNoProfile() {
  setContent(`
    <div style="margin-top:15vh;text-align:center">
      <h1>IntelliFleet</h1>
      <p class="error">Ce compte n'est pas encore configuré (aucun profil). Contacte l'administrateur.</p>
      <button class="btn btn-destructive" id="btn-logout" style="margin-top:16px">Se déconnecter</button>
    </div>
  `);
  document.getElementById('btn-logout').addEventListener('click', () => supabase.auth.signOut());
}

// ---------- Écran : accueil ----------

async function renderHome() {
  setLoading();
  const isAdmin = currentProfile?.role === 'admin';
  const [vehicles, pendingCount, myOpenTripsCount] = await Promise.all([
    listVehicles(),
    isAdmin ? countUnvalidatedEntries() : Promise.resolve(0),
    countMyOpenLogbookTrips(),
  ]);
  const activeVehicleId = getActiveVehicleId(vehicles);
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const lastEvent = activeVehicleId ? await getLastFuelEvent(activeVehicleId) : null;

  setContent(`
    ${topBarHtml('IntelliFleet', { showBack: false })}
    <div class="screen-home">
    <div class="home-layout">
      <div class="home-nav">
        <div>
          <div class="section-label">Véhicule actif</div>
          <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, activeVehicleId)}</div>
          ${vehicles.length === 0 ? '<p class="empty-text">Aucun véhicule pour ce compte.</p>' : ''}
        </div>

        <div class="link-row">
          <a href="#/history">Historique →</a>
        </div>

        ${
          isAdmin
            ? `
        <div class="link-row">
          <a href="#/vehicle-form">+ Véhicule</a>
          <a href="#/driver-form">+ Chauffeur</a>
          <a href="#/validation">Tableau de bord${pendingCount > 0 ? ` (${pendingCount})` : ''}</a>
        </div>
        `
            : ''
        }
      </div>

      <div class="home-status">
        ${
          activeVehicle
            ? `
          <div class="card">
            <p class="card-title">${escapeHtml(activeVehicle.name)}</p>
            <p class="card-subtitle">${escapeHtml(activeVehicle.plate)} · ${activeVehicle.current_km.toLocaleString('fr-FR')} km</p>
            <div class="divider"></div>
            <div class="section-label">Dernier plein</div>
            ${
              lastEvent
                ? `
              <p class="timeline-line">${lastEvent.event_date} — ${lastEvent.km.toLocaleString('fr-FR')} km</p>
              <p class="timeline-line">${lastEvent.liters} L · ${formatAmount(lastEvent.amount, vehicleCurrency(activeVehicle))}</p>
              ${lastEvent.station ? `<p class="timeline-line">${escapeHtml(lastEvent.station)}</p>` : ''}
              ${lastEvent.driver_name ? `<p class="timeline-line">Chauffeur : ${escapeHtml(lastEvent.driver_name)}</p>` : ''}
              ${!lastEvent.is_complete ? '<p class="incomplete-tag">Photos incomplètes</p>' : ''}
            `
                : '<p class="timeline-line">Aucun plein enregistré pour ce véhicule.</p>'
            }
          </div>
        `
            : ''
        }

        <div class="btn-row" style="margin-top:auto">
          <button class="btn btn-primary" id="btn-new-fuel" ${!activeVehicleId ? 'disabled' : ''}>Nouveau plein</button>
          <button class="btn btn-secondary" id="btn-new-logbook" ${!activeVehicleId ? 'disabled' : ''}>Nouveau relevé</button>
          <button class="btn btn-secondary" id="btn-close-trip">Fermer un trajet${myOpenTripsCount > 0 ? ` (${myOpenTripsCount})` : ''}</button>
        </div>
        <button class="btn btn-destructive" id="btn-logout">Se déconnecter</button>
      </div>
    </div>
    </div>
  `);

  document.querySelectorAll('#vehicle-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setActiveVehicleId(chip.dataset.id);
      renderHome();
    });
  });
  document.getElementById('btn-new-fuel')?.addEventListener('click', () => {
    location.hash = `#/fuel-event?vehicleId=${activeVehicleId}`;
  });
  document.getElementById('btn-new-logbook')?.addEventListener('click', () => {
    location.hash = `#/logbook-entry?vehicleId=${activeVehicleId}`;
  });
  document.getElementById('btn-close-trip').addEventListener('click', () => {
    location.hash = '#/close-trip';
  });
  document.getElementById('btn-logout').addEventListener('click', () => supabase.auth.signOut());
}

// ---------- Écran : fermer un trajet ----------

function myOpenTripRowHtml(trip) {
  return `
    <div class="timeline-row" role="button" tabindex="0" data-id="${trip.id}">
      <span class="timeline-dot logbook"></span>
      <span class="timeline-content">
        <span class="timeline-header">
          <span class="timeline-title">${escapeHtml(trip.vehicleName)}</span>
          <span class="timeline-date">${trip.eventDate}</span>
        </span>
        <span class="timeline-line">${trip.km.toLocaleString('fr-FR')} km (ouverture)</span>
        ${trip.driverName ? `<span class="timeline-line">Chauffeur : ${escapeHtml(trip.driverName)}</span>` : ''}
      </span>
    </div>
  `;
}

// Non cliquable, volontairement : un chauffeur ne peut pas clôturer à la place
// d'un autre — purement informatif (voir open_trips_other_drivers, 0008).
function otherOpenTripRowHtml(trip) {
  return `
    <div class="timeline-row" style="cursor:default">
      <span class="timeline-dot logbook"></span>
      <span class="timeline-content">
        <span class="timeline-header">
          <span class="timeline-title">${trip.driver_name ? escapeHtml(trip.driver_name) : 'Chauffeur non renseigné'}</span>
          <span class="timeline-date">${trip.event_date}</span>
        </span>
        <span class="timeline-line">${trip.km.toLocaleString('fr-FR')} km (ouverture)</span>
      </span>
    </div>
  `;
}

async function renderCloseTrip() {
  setLoading();
  const [vehicles, myTrips] = await Promise.all([listVehicles(), listMyOpenLogbookTrips()]);
  const activeVehicleId = getActiveVehicleId(vehicles);
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const othersOnActive = activeVehicleId ? await listOpenTripsOnVehicleByOthers(activeVehicleId) : [];

  setContent(`
    ${topBarHtml('Fermer un trajet')}
    <div class="screen-narrow">
    <div class="section-label">Tes trajets ouverts</div>
    ${myTrips.length === 0 ? '<p class="empty-text">Aucun trajet ouvert.</p>' : myTrips.map(myOpenTripRowHtml).join('')}

    ${
      activeVehicle && othersOnActive.length > 0
        ? `
    <div class="section-label">Sur ${escapeHtml(activeVehicle.name)}</div>
    ${othersOnActive.map(otherOpenTripRowHtml).join('')}
    `
        : ''
    }
    </div>
  `);

  document.querySelectorAll('.timeline-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      location.hash = `#/logbook-entry/${row.dataset.id}`;
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.hash = `#/logbook-entry/${row.dataset.id}`;
      }
    });
  });
}

// ---------- Écran : historique ----------

function toTimeline(fuelEvents, logbookEntries) {
  const fuelItems = fuelEvents.map((e) => ({
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
    validatedAt: e.validated_at,
  }));
  const logbookItems = logbookEntries.map((e) => ({
    kind: 'logbook',
    id: e.id,
    date: e.event_date,
    createdAt: e.created_at,
    km: e.km,
    driverName: e.driver_name,
    comment: e.comment,
    hasPhoto: e.photo_storage_path !== null,
    validatedAt: e.validated_at,
    closeKm: e.close_km,
  }));
  return [...fuelItems, ...logbookItems].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

function renderTimelineRow(item, currency) {
  const kindLabel = item.kind === 'fuel' ? 'Plein' : 'Relevé';
  const detailLines =
    item.kind === 'fuel'
      ? `
        <span class="timeline-line">${item.liters} L · ${formatAmount(item.amount, currency)}</span>
        ${item.station ? `<span class="timeline-line">${escapeHtml(item.station)}</span>` : ''}
        ${!item.isComplete ? '<span class="incomplete-tag">Photos incomplètes</span>' : ''}
      `
      : `
        ${item.comment ? `<span class="timeline-line">${escapeHtml(item.comment)}</span>` : ''}
        ${!item.hasPhoto ? '<span class="incomplete-tag">Sans photo</span>' : ''}
      `;
  return `
    <div class="timeline-row" role="button" tabindex="0" data-kind="${item.kind}" data-id="${item.id}">
      <span class="timeline-dot ${item.kind}"></span>
      <span class="timeline-content">
        <span class="timeline-header">
          <span class="timeline-title">${kindLabel}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="badge ${item.validatedAt ? 'badge-validated' : 'badge-pending'}">${item.validatedAt ? 'Validé' : 'Non validé'}</span>
            ${item.kind === 'logbook' && item.closeKm == null ? '<span class="badge badge-open">Ouvert</span>' : ''}
            <span class="timeline-date">${item.date}</span>
          </span>
        </span>
        <span class="timeline-line">${item.km.toLocaleString('fr-FR')} km</span>
        ${detailLines}
        ${item.driverName ? `<span class="timeline-line">Chauffeur : ${escapeHtml(item.driverName)}</span>` : ''}
      </span>
    </div>
  `;
}

async function renderHistory() {
  setLoading();
  const vehicles = await listVehicles();
  const activeVehicleId = getActiveVehicleId(vehicles);

  let items = [];
  if (activeVehicleId) {
    const [fuelEvents, logbookEntries] = await Promise.all([
      listFuelEvents(activeVehicleId),
      listLogbookEntries(activeVehicleId),
    ]);
    items = toTimeline(fuelEvents, logbookEntries);
  }
  const currency = vehicleCurrency(vehicles.find((v) => v.id === activeVehicleId));

  setContent(`
    ${topBarHtml('Historique')}
    <div class="screen-wide">
    <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, activeVehicleId)}</div>
    ${items.length === 0 ? '<p class="empty-text">Aucun événement enregistré pour ce véhicule.</p>' : ''}
    <div class="timeline-list">${items.map((item) => renderTimelineRow(item, currency)).join('')}</div>
    </div>
  `);

  document.querySelectorAll('#vehicle-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setActiveVehicleId(chip.dataset.id);
      renderHistory();
    });
  });

  function goToRow(rowEl) {
    const { kind, id } = rowEl.dataset;
    location.hash = kind === 'fuel' ? `#/fuel-event/${id}` : `#/logbook-entry/${id}`;
  }
  document.querySelectorAll('.timeline-row').forEach((rowEl) => {
    rowEl.addEventListener('click', () => goToRow(rowEl));
    rowEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToRow(rowEl);
      }
    });
  });
}

// ---------- Photo slots (partagé plein/relevé) ----------
//
// Principe (aligné sur le modèle Calepin) : l'aperçu d'une photo n'est jamais posé
// directement sur un élément DOM précis. Dès qu'un fichier est choisi, son URL de
// prévisualisation est stockée dans le MÊME état que le fichier lui-même, puis
// l'écran appelant se redessine entièrement depuis cet état (la fonction qui
// construit le HTML au chargement, rappelée telle quelle). Un re-render déclenché
// pour n'importe quelle autre raison (changement de véhicule, événement Supabase...)
// redessine donc toujours le bon aperçu au lieu de risquer de le perdre.

function photoSlotHtml(type, label, previewUrl, fullWidth, locked = false) {
  const camId = `photo-${type}-cam`;
  const galId = `photo-${type}-gal`;
  return `
    <div class="photo-slot ${fullWidth ? 'full-width' : ''}" data-type="${type}">
      <span class="slot-label">${escapeHtml(label)}</span>
      ${previewUrl ? `<img src="${previewUrl}" alt="">` : '<div class="placeholder">Aucune photo</div>'}
      ${
        locked
          ? ''
          : `
      <div class="photo-actions">
        <label for="${camId}">${previewUrl ? 'Reprendre' : 'Prendre'}</label>
        <input type="file" accept="image/*" capture="environment" id="${camId}" data-type="${type}">
        <label for="${galId}">Galerie</label>
        <input type="file" accept="image/*" id="${galId}" data-type="${type}">
      </div>
      `
      }
    </div>
  `;
}

// Compression des photos dès la sélection (caméra ou galerie), avant tout stockage
// dans l'état du formulaire. Sans ça, chaque photo 12 Mpx gardée en aperçu reste
// décodée en mémoire (~48 Mo) jusqu'au clic "Enregistrer" : 4 photos d'un plein
// suffisent à faire tuer/recharger l'onglet sur un téléphone à peu de RAM libre.
//
// Côté le plus long (et non largeur) à 1600 px : couvre aussi les photos portrait.
// C'est l'ordre de grandeur que Claude Vision exploite de toute façon (il réduit
// lui-même au-delà d'environ 1568 px), donc aucune perte pour l'OCR du compteur.
// Qualité 0.8 plutôt que 0.75 : quelques Ko de plus, mais moins d'artefacts JPEG
// autour des arêtes nettes des chiffres.
const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.8;

/**
 * Redimensionne + réencode une image en JPEG. Renvoie un Blob (image/jpeg), ou le
 * fichier d'origine si le décodage échoue (ex. HEIC non supporté par le navigateur)
 * ou si le résultat ne serait pas plus léger — l'upload se passe alors comme avant.
 * createImageBitmap plutôt qu'un <img> : décode même si la page n'est pas au premier
 * plan (img.decode() y reste en attente), applique l'orientation EXIF (option
 * imageOrientation 'from-image'), et close() libère le bitmap pleine résolution
 * immédiatement au lieu d'attendre le ramasse-miettes.
 */
async function compressImage(file, { maxDimension = PHOTO_MAX_DIMENSION, quality = PHOTO_JPEG_QUALITY } = {}) {
  let bitmap = null;
  const canvas = document.createElement('canvas');
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = null;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('canvas.toBlob a renvoyé null');
    console.info(
      `[photo] ${width}x${height} ${(file.size / 1024).toFixed(0)} Ko → ` +
        `${canvas.width}x${canvas.height} ${(blob.size / 1024).toFixed(0)} Ko`
    );
    return blob.size < file.size ? blob : file;
  } catch (err) {
    console.warn('[photo] compression impossible, fichier d’origine conservé', err);
    return file;
  } finally {
    bitmap?.close();
    canvas.width = canvas.height = 0;
  }
}

/** Libère l'URL d'aperçu locale remplacée (les signedUrl Supabase ne sont pas concernées). */
function revokePreviewUrl(url) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

/**
 * Attache les listeners des inputs file d'un ensemble de photo-slots. onPicked(type, blob)
 * reçoit l'image déjà compressée — point d'entrée unique pour le plein et le relevé.
 */
function wirePhotoInputs(container, onPicked) {
  container.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Plus de référence à l'original via l'input : seul le Blob compressé survit.
      e.target.value = '';
      onPicked(input.dataset.type, await compressImage(file));
    });
  });
}

// ---------- Écran : nouveau/modifier plein ----------

async function renderFuelEventForm(editingId, presetVehicleId) {
  setLoading();
  const [vehicles, drivers, existing] = await Promise.all([
    listVehicles(),
    listDrivers(),
    editingId ? getFuelEvent(editingId) : Promise.resolve(null),
  ]);

  const state = {
    vehicleId: existing ? existing.vehicle_id : (presetVehicleId ?? vehicles[0]?.id ?? null),
    driverId: existing ? existing.driver_id : null,
    eventDate: existing ? existing.event_date : todayIso(),
    km: existing ? String(existing.km) : '',
    liters: existing ? String(existing.liters) : '',
    amount: existing ? String(existing.amount) : '',
    station: existing ? (existing.station ?? '') : '',
    notes: existing ? (existing.notes ?? '') : '',
  };
  // photoState[type] = { file, previewUrl }. file reste null tant que l'emplacement
  // n'a pas été (re)pris — c'est ce qui indique, à l'enregistrement, quels
  // emplacements réuploader (jamais ceux restés inchangés).
  const photoState = {};
  for (const { type } of PHOTO_TYPES) {
    photoState[type] = { file: null, previewUrl: existing?.photos?.[type]?.signedUrl ?? null };
  }

  // Verrou de validation (0005_fleet_multi_user.sql) : un compte non-admin ne peut
  // plus rien modifier une fois l'entrée validée — la policy RLS le refuserait de
  // toute façon, mais on l'affiche clairement plutôt que de laisser un formulaire
  // trompeur (des champs qu'on peut remplir pour rien).
  const locked = !!(existing?.validated_at) && currentProfile?.role !== 'admin';

  // Bouton "Valider" : admin only, seulement sur une entrée existante pas encore
  // validée (une fois validated_at posé, plus besoin — l'admin garde Enregistrer/
  // Supprimer comme avant).
  const canValidate = !!editingId && !!existing && !existing.validated_at && currentProfile?.role === 'admin';

  // OCR compteur (0009_ocr_odometer.sql) : lecture de référence, jamais modifiée
  // depuis cet écran — juste affichée à titre indicatif si elle diverge du km saisi.
  const ocrKm = existing?.ocr_km ?? null;
  const ocrAnalyzedAt = existing?.ocr_analyzed_at ?? null;

  function currentVehicle() {
    return vehicles.find((v) => v.id === state.vehicleId) ?? null;
  }

  function renderForm() {
    setContent(`
      ${topBarHtml(editingId ? 'Modifier le plein' : 'Nouveau plein')}
      <div class="screen-narrow">

      ${locked ? `<p class="warning">Validé le ${existing.validated_at.slice(0, 10)} — modification impossible.</p>` : ''}

      <div class="section-label">Photos (optionnelles à la saisie)</div>
      <div class="photo-grid" id="photo-grid">
        ${PHOTO_TYPES.map(({ type, label }) => photoSlotHtml(type, label, photoState[type].previewUrl, false, locked)).join('')}
      </div>

      <div class="section-label">Véhicule</div>
      <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, state.vehicleId)}</div>

      <div class="section-label">Chauffeur (optionnel)</div>
      <div class="chip-row" id="driver-chips">
        <button class="chip ${state.driverId === null ? 'active' : ''}" data-id="" ${locked ? 'disabled' : ''}>Aucun</button>
        ${drivers.map((d) => `<button class="chip ${state.driverId === d.id ? 'active' : ''}" data-id="${d.id}" ${locked ? 'disabled' : ''}>${escapeHtml(d.name)}</button>`).join('')}
      </div>

      <div class="section-label">Détails</div>
      <div class="field"><label>Date (AAAA-MM-JJ)</label><input type="date" id="f-date" value="${state.eventDate}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Km</label><input type="number" inputmode="numeric" id="f-km" value="${escapeHtml(state.km)}" ${locked ? 'disabled' : ''}></div>
      <p class="warning" id="km-warning" hidden></p>
      <p class="warning" id="ocr-km-info" hidden></p>
      <div class="field"><label>Litres</label><input type="number" step="0.01" inputmode="decimal" id="f-liters" value="${escapeHtml(state.liters)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Montant (<span id="amount-currency">${vehicleCurrency(currentVehicle())}</span>)</label><input type="number" inputmode="numeric" id="f-amount" value="${escapeHtml(state.amount)}" ${locked ? 'disabled' : ''}></div>
      <p class="computed-info" id="unit-price-info" hidden></p>
      <div class="field"><label>Station</label><input type="text" id="f-station" value="${escapeHtml(state.station)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Notes</label><textarea id="f-notes" ${locked ? 'disabled' : ''}>${escapeHtml(state.notes)}</textarea></div>

      <p class="error" id="form-error" hidden></p>
      ${
        locked
          ? ''
          : `
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
        ${canValidate ? '<button class="btn btn-secondary" id="btn-validate">Valider</button>' : ''}
      </div>
      ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce plein</button>' : ''}
      `
      }
      </div>
    `);

    renderKmWarning();
    renderUnitPriceInfo();
    renderOcrKmInfo();

    if (locked) return; // aucun listener d'édition à attacher, tout est en lecture seule

    document.querySelectorAll('#vehicle-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.vehicleId = chip.dataset.id;
        document.querySelectorAll('#vehicle-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderKmWarning();
        renderCurrency();
      });
    });
    document.querySelectorAll('#driver-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.driverId = chip.dataset.id || null;
        document.querySelectorAll('#driver-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      });
    });

    document.getElementById('f-date').addEventListener('input', (e) => (state.eventDate = e.target.value));
    document.getElementById('f-km').addEventListener('input', (e) => {
      state.km = e.target.value;
      renderKmWarning();
      renderOcrKmInfo();
    });
    document.getElementById('f-liters').addEventListener('input', (e) => {
      state.liters = e.target.value;
      renderUnitPriceInfo();
    });
    document.getElementById('f-amount').addEventListener('input', (e) => {
      state.amount = e.target.value;
      renderUnitPriceInfo();
    });
    document.getElementById('f-station').addEventListener('input', (e) => (state.station = e.target.value));
    document.getElementById('f-notes').addEventListener('input', (e) => (state.notes = e.target.value));

    wirePhotoInputs(document.getElementById('photo-grid'), (type, file) => {
      revokePreviewUrl(photoState[type].previewUrl);
      photoState[type] ={ ...photoState[type], file, previewUrl: URL.createObjectURL(file) };
      renderForm();
    });

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
    document.getElementById('btn-validate')?.addEventListener('click', handleValidate);
    document.getElementById('btn-delete')?.addEventListener('click', handleDelete);
  }

  function renderKmWarning() {
    const vehicle = currentVehicle();
    const el = document.getElementById('km-warning');
    if (!el) return;
    const warning = vehicle ? checkKmConsistency(parseInt(state.km, 10), vehicle.current_km) : null;
    el.textContent = warning ?? '';
    el.hidden = !warning;
  }

  function renderOcrKmInfo() {
    const el = document.getElementById('ocr-km-info');
    if (!el) return;
    const info = computeOcrKmInfo(state.km, ocrKm, ocrAnalyzedAt);
    el.textContent = info ?? '';
    el.hidden = !info;
  }

  /** La devise suit le véhicule sélectionné, pas celui présent à l'ouverture. */
  function renderCurrency() {
    const el = document.getElementById('amount-currency');
    if (el) el.textContent = vehicleCurrency(currentVehicle());
    renderUnitPriceInfo();
  }

  function renderUnitPriceInfo() {
    const el = document.getElementById('unit-price-info');
    if (!el) return;
    const price = computeUnitPrice(state.liters, state.amount);
    el.textContent = price ? `≈ ${price.toLocaleString('fr-FR')} ${vehicleCurrency(currentVehicle())}/L (calculé)` : '';
    el.hidden = !price;
  }

  /** Valide les champs et construit l'input pour createFuelEvent/updateFuelEvent.
   *  Affiche elle-même l'erreur et renvoie null si un champ est invalide — partagé
   *  entre "Enregistrer" et "Valider", mêmes règles pour les deux. */
  function validateAndBuildInput() {
    const errorEl = document.getElementById('form-error');
    if (!state.vehicleId) {
      errorEl.textContent = 'Sélectionne un véhicule.';
      errorEl.hidden = false;
      return null;
    }
    const kmNum = parseInt(state.km, 10);
    const litersNum = parseFloat(state.liters);
    const amountNum = parseInt(state.amount, 10);
    // Recalculé à chaque enregistrement, création comme édition : une ancienne entrée
    // dont on corrige litres/montant garde un prix cohérent avec eux.
    const unitPriceNum = computeUnitPrice(state.liters, state.amount);
    if (!state.eventDate || Number.isNaN(kmNum) || Number.isNaN(litersNum) || Number.isNaN(amountNum) || unitPriceNum === null) {
      errorEl.textContent = 'Vérifie la date, le km, les litres et le montant.';
      errorEl.hidden = false;
      return null;
    }
    return {
      vehicleId: state.vehicleId,
      driverId: state.driverId,
      eventDate: state.eventDate,
      km: kmNum,
      liters: litersNum,
      unitPrice: unitPriceNum,
      amount: amountNum,
      station: state.station.trim() || null,
      notes: state.notes.trim() || null,
    };
  }

  /** Enregistre (création ou mise à jour) + upload des photos changées. Partagé
   *  entre "Enregistrer" et "Valider" — laisse les erreurs remonter à l'appelant. */
  async function saveEntry(input) {
    const event = editingId ? await updateFuelEvent(editingId, input) : await createFuelEvent(input);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      for (const { type } of PHOTO_TYPES) {
        if (photoState[type].file) {
          await uploadFuelEventPhoto({ fuelEventId: event.id, ownerId: user.id, type, file: photoState[type].file });
        }
      }
    }
    return event;
  }

  function setActionButtonsDisabled(disabled) {
    document.getElementById('btn-submit').disabled = disabled;
    const validateBtn = document.getElementById('btn-validate');
    if (validateBtn) validateBtn.disabled = disabled;
  }

  async function handleSubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('btn-submit');
    errorEl.hidden = true;
    const input = validateAndBuildInput();
    if (!input) return;

    setActionButtonsDisabled(true);
    submitBtn.textContent = 'Enregistrement…';
    try {
      await saveEntry(input);
      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
    }
  }

  /** "Valider" : enregistre d'abord (mêmes règles que "Enregistrer"), puis valide
   *  l'entrée — redirige vers #/validation (pas l'accueil), pour enchaîner sur
   *  l'entrée suivante à vérifier. Erreurs distinguées : un échec d'enregistrement
   *  n'a pas le même sens qu'un enregistrement réussi suivi d'un échec de
   *  validation (l'admin sait alors que ses modifications sont bien passées). */
  async function handleValidate() {
    const errorEl = document.getElementById('form-error');
    const validateBtn = document.getElementById('btn-validate');
    errorEl.hidden = true;
    const input = validateAndBuildInput();
    if (!input) return;

    setActionButtonsDisabled(true);
    validateBtn.textContent = 'Enregistrement…';
    try {
      await saveEntry(input);
    } catch (e) {
      errorEl.textContent = `Erreur lors de l'enregistrement : ${e.message || String(e)}`;
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      validateBtn.textContent = 'Valider';
      return;
    }

    validateBtn.textContent = 'Validation…';
    try {
      await validateFuelEvent(editingId);
      location.hash = '#/validation';
    } catch (e) {
      errorEl.textContent = `Enregistré, mais la validation a échoué : ${e.message || String(e)}`;
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      validateBtn.textContent = 'Valider';
    }
  }

  async function handleDelete() {
    if (!confirm('Supprimer ce plein ? Cette action est irréversible.')) return;
    const errorEl = document.getElementById('form-error');
    try {
      await deleteFuelEvent(editingId);
      location.hash = '#/history';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    }
  }

  renderForm();
}

// ---------- Écran : nouveau/modifier relevé ----------

async function renderLogbookEntryForm(editingId, presetVehicleId) {
  setLoading();
  const [vehicles, drivers, existing] = await Promise.all([
    listVehicles(),
    listDrivers(),
    editingId ? getLogbookEntry(editingId) : Promise.resolve(null),
  ]);

  const state = {
    vehicleId: existing ? existing.vehicle_id : (presetVehicleId ?? vehicles[0]?.id ?? null),
    driverId: existing ? existing.driver_id : null,
    eventDate: existing ? existing.event_date : todayIso(),
    km: existing ? String(existing.km) : '',
    comment: existing ? (existing.comment ?? '') : '',
    closeKm: existing?.close_km != null ? String(existing.close_km) : '',
    closeAt: existing ? toDatetimeLocalValue(existing.close_at) : '',
  };
  const originalPhotoUrl = existing ? existing.photoSignedUrl : null;
  const photo = { file: null, previewUrl: originalPhotoUrl };

  // Verrou de validation (0005_fleet_multi_user.sql), même principe que le formulaire
  // de plein.
  const locked = !!(existing?.validated_at) && currentProfile?.role !== 'admin';

  // Bouton "Valider" : admin only, seulement sur une entrée existante pas encore
  // validée — même règle que pour le formulaire de plein.
  const canValidate = !!editingId && !!existing && !existing.validated_at && currentProfile?.role === 'admin';

  // OCR compteur (0009_ocr_odometer.sql) : lecture de référence, jamais modifiée
  // depuis cet écran — juste affichée à titre indicatif si elle diverge du km saisi.
  const ocrKm = existing?.ocr_km ?? null;
  const ocrAnalyzedAt = existing?.ocr_analyzed_at ?? null;

  function currentVehicle() {
    return vehicles.find((v) => v.id === state.vehicleId) ?? null;
  }

  function renderForm() {
    setContent(`
      ${topBarHtml(editingId ? 'Modifier le relevé' : 'Nouveau relevé')}
      <div class="screen-narrow">

      ${locked ? `<p class="warning">Validé le ${existing.validated_at.slice(0, 10)} — modification impossible.</p>` : ''}

      <div class="section-label">Photo (optionnelle)</div>
      <div class="photo-grid" id="photo-grid">
        ${photoSlotHtml('odometer', 'Compteur', photo.previewUrl, true, locked)}
      </div>

      <div class="section-label">Véhicule</div>
      <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, state.vehicleId)}</div>

      <div class="section-label">Chauffeur (optionnel)</div>
      <div class="chip-row" id="driver-chips">
        <button class="chip ${state.driverId === null ? 'active' : ''}" data-id="" ${locked ? 'disabled' : ''}>Aucun</button>
        ${drivers.map((d) => `<button class="chip ${state.driverId === d.id ? 'active' : ''}" data-id="${d.id}" ${locked ? 'disabled' : ''}>${escapeHtml(d.name)}</button>`).join('')}
      </div>

      <div class="section-label">Détails</div>
      <div class="field"><label>Date (AAAA-MM-JJ)</label><input type="date" id="f-date" value="${state.eventDate}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Km</label><input type="number" inputmode="numeric" id="f-km" value="${escapeHtml(state.km)}" ${locked ? 'disabled' : ''}></div>
      <p class="warning" id="km-warning" hidden></p>
      <p class="warning" id="ocr-km-info" hidden></p>
      <div class="field"><label>Commentaire (optionnel)</label><textarea id="f-comment" ${locked ? 'disabled' : ''}>${escapeHtml(state.comment)}</textarea></div>

      ${
        editingId
          ? `
      <div class="section-label">Clôture du trajet (optionnelle)</div>
      <div class="field"><label>Km de clôture</label><input type="number" inputmode="numeric" id="f-close-km" value="${escapeHtml(state.closeKm)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Heure de clôture</label><input type="datetime-local" id="f-close-at" value="${escapeHtml(state.closeAt)}" ${locked ? 'disabled' : ''}></div>
      <p class="warning" id="close-km-warning" hidden></p>
      `
          : ''
      }

      <p class="error" id="form-error" hidden></p>
      ${
        locked
          ? ''
          : `
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
        ${canValidate ? '<button class="btn btn-secondary" id="btn-validate">Valider</button>' : ''}
      </div>
      ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce relevé</button>' : ''}
      `
      }
      </div>
    `);

    renderKmWarning();
    renderCloseKmWarning();
    renderOcrKmInfo();

    if (locked) return;

    document.querySelectorAll('#vehicle-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.vehicleId = chip.dataset.id;
        document.querySelectorAll('#vehicle-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderKmWarning();
      });
    });
    document.querySelectorAll('#driver-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.driverId = chip.dataset.id || null;
        document.querySelectorAll('#driver-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      });
    });

    document.getElementById('f-date').addEventListener('input', (e) => (state.eventDate = e.target.value));
    document.getElementById('f-km').addEventListener('input', (e) => {
      state.km = e.target.value;
      renderKmWarning();
      renderCloseKmWarning();
      renderOcrKmInfo();
    });
    document.getElementById('f-comment').addEventListener('input', (e) => (state.comment = e.target.value));
    document.getElementById('f-close-km')?.addEventListener('input', (e) => {
      state.closeKm = e.target.value;
      renderCloseKmWarning();
    });
    document.getElementById('f-close-at')?.addEventListener('input', (e) => (state.closeAt = e.target.value));

    wirePhotoInputs(document.getElementById('photo-grid'), (_type, file) => {
      revokePreviewUrl(photo.previewUrl);
      photo.file = file;
      photo.previewUrl = URL.createObjectURL(file);
      renderForm();
    });

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
    document.getElementById('btn-validate')?.addEventListener('click', handleValidate);
    document.getElementById('btn-delete')?.addEventListener('click', handleDelete);
  }

  function renderKmWarning() {
    const vehicle = currentVehicle();
    const el = document.getElementById('km-warning');
    if (!el) return;
    const warning = vehicle ? checkKmConsistency(parseInt(state.km, 10), vehicle.current_km) : null;
    el.textContent = warning ?? '';
    el.hidden = !warning;
  }

  function renderOcrKmInfo() {
    const el = document.getElementById('ocr-km-info');
    if (!el) return;
    const info = computeOcrKmInfo(state.km, ocrKm, ocrAnalyzedAt);
    el.textContent = info ?? '';
    el.hidden = !info;
  }

  function renderCloseKmWarning() {
    const el = document.getElementById('close-km-warning');
    if (!el) return;
    const warning = computeCloseKmWarning(state.km, state.closeKm);
    el.textContent = warning ?? '';
    el.hidden = !warning;
  }

  /** Même patron que le formulaire de plein : partagé entre "Enregistrer" et
   *  "Valider". */
  function validateAndBuildInput() {
    const errorEl = document.getElementById('form-error');
    if (!state.vehicleId) {
      errorEl.textContent = 'Sélectionne un véhicule.';
      errorEl.hidden = false;
      return null;
    }
    const kmNum = parseInt(state.km, 10);
    if (!state.eventDate || Number.isNaN(kmNum)) {
      errorEl.textContent = 'Vérifie la date et le km.';
      errorEl.hidden = false;
      return null;
    }
    // Clôture optionnelle, mais jamais à moitié renseignée : un close_km sans
    // close_at (ou l'inverse) ferait planter l'algorithme de segmentation du
    // tableau de bord (monthKey(null)) — protégé aussi en base (0007), mais
    // autant l'empêcher ici avant l'aller-retour serveur.
    const closeKmNum = state.closeKm ? parseInt(state.closeKm, 10) : null;
    const closeAtIso = state.closeAt ? new Date(state.closeAt).toISOString() : null;
    if ((closeKmNum != null) !== (closeAtIso != null)) {
      errorEl.textContent = 'Km de clôture et heure de clôture doivent être renseignés ensemble (ou laissés vides).';
      errorEl.hidden = false;
      return null;
    }
    return {
      vehicleId: state.vehicleId,
      driverId: state.driverId,
      km: kmNum,
      eventDate: state.eventDate,
      comment: state.comment.trim() || null,
      closeKm: closeKmNum,
      closeAt: closeAtIso,
    };
  }

  async function saveEntry(input) {
    const entry = editingId ? await updateLogbookEntry(editingId, input) : await createLogbookEntry(input);
    if (photo.file) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await uploadLogbookEntryPhoto({ logbookEntryId: entry.id, ownerId: user.id, file: photo.file });
      }
    }
    return entry;
  }

  function setActionButtonsDisabled(disabled) {
    document.getElementById('btn-submit').disabled = disabled;
    const validateBtn = document.getElementById('btn-validate');
    if (validateBtn) validateBtn.disabled = disabled;
  }

  async function handleSubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('btn-submit');
    errorEl.hidden = true;
    const input = validateAndBuildInput();
    if (!input) return;

    setActionButtonsDisabled(true);
    submitBtn.textContent = 'Enregistrement…';
    try {
      await saveEntry(input);
      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
    }
  }

  /** "Valider" : voir le commentaire équivalent dans renderFuelEventForm — même
   *  logique, juste appliquée à un relevé. */
  async function handleValidate() {
    const errorEl = document.getElementById('form-error');
    const validateBtn = document.getElementById('btn-validate');
    errorEl.hidden = true;
    const input = validateAndBuildInput();
    if (!input) return;

    setActionButtonsDisabled(true);
    validateBtn.textContent = 'Enregistrement…';
    try {
      await saveEntry(input);
    } catch (e) {
      errorEl.textContent = `Erreur lors de l'enregistrement : ${e.message || String(e)}`;
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      validateBtn.textContent = 'Valider';
      return;
    }

    validateBtn.textContent = 'Validation…';
    try {
      await validateLogbookEntry(editingId);
      location.hash = '#/validation';
    } catch (e) {
      errorEl.textContent = `Enregistré, mais la validation a échoué : ${e.message || String(e)}`;
      errorEl.hidden = false;
      setActionButtonsDisabled(false);
      validateBtn.textContent = 'Valider';
    }
  }

  async function handleDelete() {
    if (!confirm('Supprimer ce relevé ? Cette action est irréversible.')) return;
    const errorEl = document.getElementById('form-error');
    try {
      await deleteLogbookEntry(editingId);
      location.hash = '#/history';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    }
  }

  renderForm();
}

// ---------- Écran : signaler un problème ----------

// Lit le numéro de version depuis le tag <script> chargeant app.js (même paramètre
// ?v=... que celui géré par scripts/bump-cache-version.mjs) — aucun système de
// versionnage séparé à entretenir en parallèle.
function currentAppVersion() {
  const src = document.querySelector('script[src*="app.js"]')?.src ?? '';
  const match = src.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

async function renderReportBug(fromHash) {
  // fromHash vient de query.get('from') donc déjà décodé ; c'est le hash (sans '#')
  // de l'écran d'où l'utilisateur est venu, capturé par topBarHtml() au moment où
  // il a cliqué sur "Signaler un problème" — pas '/report-bug' lui-même.
  const originHash = fromHash ? `#${fromHash}` : '#/';

  setContent(`
    ${topBarHtml('Signaler un problème')}
    <div class="screen-narrow">
    <div class="field">
      <label>Qu'est-ce qui s'est passé ?</label>
      <textarea id="f-description" rows="6" placeholder="Décris le problème, même brièvement — le contexte technique est capturé automatiquement."></textarea>
    </div>
    <p class="error" id="form-error" hidden></p>
    <button class="btn btn-primary" id="btn-send">Envoyer</button>
    </div>
  `);

  const errorEl = document.getElementById('form-error');
  const sendBtn = document.getElementById('btn-send');

  sendBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    const description = document.getElementById('f-description').value.trim();
    if (!description) {
      errorEl.textContent = 'Décris le problème avant d’envoyer.';
      errorEl.hidden = false;
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Envoi…';
    try {
      await createBugReport({
        description,
        screenHash: originHash.slice(1),
        role: currentProfile?.role ?? null,
        browserInfo: `${navigator.userAgent} | ${window.innerWidth}x${window.innerHeight}`,
        appVersion: currentAppVersion(),
      });
      setContent(`
        ${topBarHtml('Signaler un problème')}
        <div class="screen-narrow">
        <p class="success">Merci, ton signalement a bien été envoyé.</p>
        <a href="${originHash}" class="top-bar-back">← Retour à l'écran précédent</a>
        </div>
      `);
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Envoyer';
    }
  });
}

// ---------- Écran : nouveau véhicule (admin only) ----------

async function renderVehicleForm() {
  setContent(`
    ${topBarHtml('Nouveau véhicule')}
    <div class="screen-narrow">
    <div class="field"><label>Nom</label><input type="text" id="f-name"></div>
    <div class="field"><label>Plaque</label><input type="text" id="f-plate"></div>
    <div class="field"><label>Marque</label><input type="text" id="f-make"></div>
    <div class="field"><label>Modèle</label><input type="text" id="f-model"></div>
    <div class="field"><label>Année (optionnel)</label><input type="number" inputmode="numeric" id="f-year"></div>
    <div class="field"><label>Km initial</label><input type="number" inputmode="numeric" id="f-initial-km" value="0"></div>
    <div class="field"><label>Capacité réservoir en litres (optionnel)</label><input type="number" step="0.1" inputmode="decimal" id="f-tank"></div>
    <div class="field"><label>Groupe de flotte</label><select id="f-fleet-group">
      <option value="">Aucun (visible par l'admin seulement)</option>
      ${FLEET_GROUPS.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
    </select></div>
    <p class="error" id="form-error" hidden></p>
    <button class="btn btn-primary" id="btn-submit">Créer le véhicule</button>
    </div>
  `);

  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('btn-submit');

  submitBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    const name = document.getElementById('f-name').value.trim();
    const plate = document.getElementById('f-plate').value.trim();
    const make = document.getElementById('f-make').value.trim();
    const model = document.getElementById('f-model').value.trim();
    const yearRaw = document.getElementById('f-year').value;
    const initialKmRaw = document.getElementById('f-initial-km').value;
    const tankRaw = document.getElementById('f-tank').value;
    const fleetGroupRaw = document.getElementById('f-fleet-group').value;
    if (!name || !plate || !make || !model) {
      errorEl.textContent = 'Nom, plaque, marque et modèle sont obligatoires.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Création…';
    try {
      await createVehicle({
        name,
        plate,
        make,
        model,
        year: yearRaw ? parseInt(yearRaw, 10) : null,
        initialKm: initialKmRaw ? parseInt(initialKmRaw, 10) : 0,
        tankCapacityLiters: tankRaw ? parseFloat(tankRaw) : null,
        fleetGroup: fleetGroupRaw || null,
      });
      location.hash = '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Créer le véhicule';
    }
  });
}

// ---------- Écran : nouveau chauffeur (admin only) ----------

async function renderDriverForm() {
  setContent(`
    ${topBarHtml('Nouveau chauffeur')}
    <div class="screen-narrow">
    <div class="field"><label>Nom</label><input type="text" id="f-name"></div>
    <p class="error" id="form-error" hidden></p>
    <button class="btn btn-primary" id="btn-submit">Créer le chauffeur</button>
    </div>
  `);

  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('btn-submit');

  submitBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    const name = document.getElementById('f-name').value.trim();
    if (!name) {
      errorEl.textContent = 'Le nom est obligatoire.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Création…';
    try {
      await createDriver({ name });
      location.hash = '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Créer le chauffeur';
    }
  });
}

// ---------- Écran : validation + tableau de bord (admin only) ----------
//
// Un seul écran, deux zones (#/validation) :
// - Zone 1 (actions, à valider / validées récemment) : TOUJOURS fleet-wide, jamais
//   filtrée par le sélecteur de la zone 2 — c'est une file de travail, l'admin doit
//   voir tout ce qui attend une action peu importe la vue choisie pour les indicateurs.
// - Zone 2 (indicateurs, ex-#/dashboard) : re-rendue seule (#dashboard-zone) sur
//   changement de vue/métrique, pour ne jamais perdre les cases cochées de la zone 1.

// Cliquable : renvoie vers l'écran d'édition existant du plein/relevé, pour
// comparer facilement la lecture Claude Vision (affichée là-bas) au km saisi.
function validationThumbsHtml(item) {
  if (item.photos.length === 0) return '<span class="empty-text">—</span>';
  const href = item.kind === 'fuel' ? `#/fuel-event/${item.id}` : `#/logbook-entry/${item.id}`;
  return `<a class="validation-thumbs" href="${href}">${item.photos.map((p) => `<img class="validation-thumb-sm" src="${p.signedUrl}" alt="${escapeHtml(p.type)}">`).join('')}</a>`;
}

// ---------- OCR compteur (0009_ocr_odometer.sql) ----------

function ocrWithinTolerance(item) {
  return item.ocrKm != null && Math.abs(item.ocrKm - item.km) <= OCR_KM_TOLERANCE;
}

function ocrMismatch(item) {
  return item.ocrKm != null && Math.abs(item.ocrKm - item.km) > OCR_KM_TOLERANCE;
}

/** Contenu de la cellule Km : la valeur saisie + un badge si Claude Vision a lu
 *  un km trop éloigné (au-delà d'OCR_KM_TOLERANCE) — partagé entre le rendu
 *  initial et la mise à jour d'une ligne après analyse (updateRowAfterOcr). */
function ocrKmCellHtml(item) {
  return `
    ${item.km.toLocaleString('fr-FR')}
    ${
      ocrMismatch(item)
        ? `<div class="incomplete-tag">Claude Vision : ${item.ocrKm.toLocaleString('fr-FR')} km, saisi : ${item.km.toLocaleString('fr-FR')} km — à vérifier</div>`
        : ''
    }
  `;
}

function validationPendingTableHtml(items) {
  if (items.length === 0) return '<p class="empty-text">Rien à valider.</p>';
  const rows = items
    .map(
      (item) => `
    <tr data-row-kind="${item.kind}" data-row-id="${item.id}">
      <td><input type="checkbox" class="validation-checkbox" data-kind="${item.kind}" data-id="${item.id}" ${ocrWithinTolerance(item) ? 'checked' : ''}></td>
      <td>${item.kind === 'fuel' ? 'Plein' : 'Relevé'}</td>
      <td>${escapeHtml(item.vehicleName)}</td>
      <td>${item.date}</td>
      <td class="ocr-km-cell">${ocrKmCellHtml(item)}</td>
      <td>${item.driverName ? escapeHtml(item.driverName) : '—'}</td>
      <td>
        ${validationThumbsHtml(item)}
        ${item.ocrPhotoStoragePath ? `<button class="btn btn-secondary btn-sm" data-action="analyze-ocr" data-kind="${item.kind}" data-id="${item.id}">Analyser</button>` : ''}
      </td>
    </tr>
  `
    )
    .join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table validation-table">
        <thead>
          <tr>
            <th><input type="checkbox" id="select-all-pending"></th>
            <th>Type</th><th>Véhicule</th><th>Date</th><th>Km</th><th>Chauffeur</th><th>Photos</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function validationDoneTableHtml(items) {
  if (items.length === 0) return '<p class="empty-text">Aucune entrée validée récemment.</p>';
  const rows = items
    .map(
      (item) => `
    <tr>
      <td>${item.kind === 'fuel' ? 'Plein' : 'Relevé'}</td>
      <td>${escapeHtml(item.vehicleName)}</td>
      <td>${item.date}</td>
      <td>${item.km.toLocaleString('fr-FR')}</td>
      <td>${item.driverName ? escapeHtml(item.driverName) : '—'}</td>
      <td>${validationThumbsHtml(item)}</td>
      <td>${item.photos.length > 0 ? `<button class="btn btn-destructive btn-sm" data-action="delete-photos" data-kind="${item.kind}" data-id="${item.id}">Supprimer les photos</button>` : ''}</td>
    </tr>
  `
    )
    .join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table validation-table">
        <thead><tr><th>Type</th><th>Véhicule</th><th>Date</th><th>Km</th><th>Chauffeur</th><th>Photos</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

const DASHBOARD_VIEWS = [
  { key: 'vehicle', label: 'Par véhicule' },
  { key: 'group', label: 'Par groupe' },
  { key: 'total', label: 'Total flotte' },
];

// État local de l'écran (vue + sélection + métrique du graphique). Pas de persistance
// (localStorage) volontaire : contrairement au véhicule actif de l'accueil, ce choix
// n'a pas besoin de survivre à une navigation ailleurs puis un retour.
let dashboardState = null;

function dashboardChartSvg(monthlyAsc, metric, mixedCurrency) {
  if (metric === 'cost' && mixedCurrency) {
    return '<p class="empty-text">Coûts non affichés : cette vue mélange plusieurs devises.</p>';
  }
  const width = 320;
  const height = 130;
  const padding = 22;
  const points = monthlyAsc
    .map((r) => ({ month: r.month, value: metric === 'cost' ? r.amount : r.litersPer100km }))
    .filter((p) => p.value != null);

  if (points.length === 0) {
    return '<p class="empty-text">Pas assez de données pour le graphique.</p>';
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - 2 * padding) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: height - padding - ((p.value - min) / range) * (height - 2 * padding),
    month: p.month,
  }));

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="var(--blue)"></circle>`)
    .join('');
  const first = coords[0];
  const last = coords[coords.length - 1];

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Évolution mensuelle">
      <polyline points="${polyline}" fill="none" stroke="var(--blue)" stroke-width="2"></polyline>
      ${dots}
      <text x="${first.x.toFixed(1)}" y="${height - 6}" font-size="9" fill="var(--text-muted)">${escapeHtml(formatMonthLabel(first.month))}</text>
      <text x="${last.x.toFixed(1)}" y="${height - 6}" text-anchor="end" font-size="9" fill="var(--text-muted)">${escapeHtml(formatMonthLabel(last.month))}</text>
    </svg>
  `;
}

/** mixedCurrency : Coût et Coût/km remplacés par "—" (jamais de somme RWF + BIF).
 *  currency : devise unique de la vue, affichée dans les en-têtes. */
function dashboardMonthlyTableHtml(monthly, currency, mixedCurrency) {
  const currencyLabel = currency ? ` (${currency})` : '';
  if (monthly.length === 0) return '<p class="empty-text">Aucune donnée validée pour cette sélection.</p>';
  const rows = monthly
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(formatMonthLabel(r.month))}</td>
      <td>${r.km.toLocaleString('fr-FR')}</td>
      <td>${r.liters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
      <td>${mixedCurrency ? '—' : Math.round(r.amount).toLocaleString('fr-FR')}</td>
      <td>${!mixedCurrency && r.costPerKm != null ? Math.round(r.costPerKm).toLocaleString('fr-FR') : '—'}</td>
      <td>${r.litersPer100km != null ? r.litersPer100km.toFixed(1) : '—'}</td>
    </tr>
  `
    )
    .join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Mois</th><th>Km</th><th>Litres</th><th>Coût${currencyLabel}</th><th>Coût/km${currencyLabel}</th><th>L/100km</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function dashboardDriverTableHtml(drivers) {
  if (drivers.length === 0) return '<p class="empty-text">Aucun segment pour cette sélection.</p>';
  const rows = drivers
    .map(
      (d) => `
    <tr>
      <td>${escapeHtml(d.driverName ?? 'Non attribué')}</td>
      <td>${d.km.toLocaleString('fr-FR')}</td>
      <td>${d.segmentCount}</td>
    </tr>
  `
    )
    .join('');
  return `
    <table class="data-table">
      <thead><tr><th>Chauffeur</th><th>Km attribué</th><th>Saisies</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderValidation() {
  setLoading();
  const [pendingFuel, pendingLogbook, doneFuel, doneLogbook, vehicles, validatedFuelAll, validatedLogbookAll] = await Promise.all([
    listUnvalidatedFuelEvents(),
    listUnvalidatedLogbookEntries(),
    listRecentlyValidatedFuelEvents(),
    listRecentlyValidatedLogbookEntries(),
    listVehicles(),
    listValidatedFuelEventsAll(),
    listValidatedLogbookEntriesAll(),
  ]);
  const byDateDesc = (a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);
  const pending = [...pendingFuel, ...pendingLogbook].sort(byDateDesc);
  const done = [...doneFuel, ...doneLogbook].sort(byDateDesc);
  const groups = groupVehiclesByFleetGroup(vehicles);

  if (!dashboardState) {
    dashboardState = {
      view: 'vehicle',
      vehicleId: vehicles[0]?.id ?? null,
      group: groups[0]?.group ?? null,
      metric: 'cost',
    };
  }

  setContent(`
    ${topBarHtml('Tableau de bord')}
    <div class="screen-dashboard">
    <p class="error" id="validation-error" hidden></p>

    <div class="section-label">À valider (${pending.length})</div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-validate-selected" disabled>Valider la sélection (0)</button>
    </div>
    ${validationPendingTableHtml(pending)}

    <div class="section-label">Validées récemment</div>
    ${validationDoneTableHtml(done)}

    <div class="divider"></div>
    <div class="section-label">Vue d'ensemble</div>
    <div id="dashboard-zone"></div>
    </div>
  `);

  const errorEl = document.getElementById('validation-error');

  // ---- Zone 1 : actions (fleet-wide, jamais filtrée par la zone 2) ----

  function updateValidateSelectedButton() {
    const btn = document.getElementById('btn-validate-selected');
    if (!btn) return;
    const checked = document.querySelectorAll('.validation-checkbox:checked').length;
    btn.textContent = `Valider la sélection (${checked})`;
    btn.disabled = checked === 0;
  }

  // dataset.manual marque une case déjà touchée par l'admin (directement ou via
  // "Tout sélectionner") — une mise à jour OCR qui arrive après (auto ou via le
  // bouton "Analyser") ne doit alors plus jamais toucher checkbox.checked.
  document.querySelectorAll('.validation-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.dataset.manual = 'true';
      updateValidateSelectedButton();
    });
  });

  document.getElementById('select-all-pending')?.addEventListener('change', (e) => {
    document.querySelectorAll('.validation-checkbox').forEach((cb) => {
      cb.checked = e.target.checked;
      cb.dataset.manual = 'true';
    });
    updateValidateSelectedButton();
  });

  document.getElementById('btn-validate-selected')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const checked = [...document.querySelectorAll('.validation-checkbox:checked')];
    errorEl.hidden = true;
    btn.disabled = true;
    try {
      await Promise.all(
        checked.map((cb) => (cb.dataset.kind === 'fuel' ? validateFuelEvent(cb.dataset.id) : validateLogbookEntry(cb.dataset.id)))
      );
      await renderValidation();
    } catch (err) {
      errorEl.textContent = err.message || String(err);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });

  document.querySelectorAll('[data-action="delete-photos"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer les photos de cette entrée ? Cette action est irréversible.')) return;
      errorEl.hidden = true;
      btn.disabled = true;
      try {
        if (btn.dataset.kind === 'fuel') await deleteFuelEventPhotos(btn.dataset.id);
        else await deleteLogbookEntryPhoto(btn.dataset.id);
        await renderValidation();
      } catch (e) {
        errorEl.textContent = e.message || String(e);
        errorEl.hidden = false;
        btn.disabled = false;
      }
    });
  });

  // ---- OCR compteur (0009_ocr_odometer.sql) : auto au chargement + bouton
  // "Analyser" manuel, même logique sous-jacente ----

  /** Met à jour la ligne DOM d'un item après une analyse (auto ou manuelle) :
   *  jamais la case à cocher si l'admin l'a déjà touchée (dataset.manual). */
  function updateRowAfterOcr(item) {
    const row = document.querySelector(`tr[data-row-kind="${item.kind}"][data-row-id="${item.id}"]`);
    if (!row) return; // ligne disparue entretemps (ex. validée puis écran rechargé)

    const kmCell = row.querySelector('.ocr-km-cell');
    if (kmCell) kmCell.innerHTML = ocrKmCellHtml(item);

    const checkbox = row.querySelector('.validation-checkbox');
    if (checkbox && checkbox.dataset.manual !== 'true') {
      checkbox.checked = ocrWithinTolerance(item);
      updateValidateSelectedButton();
    }

    const analyzeBtn = row.querySelector('[data-action="analyze-ocr"]');
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyser';
    }
  }

  /** Analyse un item et enregistre le résultat. Toujours suivi d'une mise à jour
   *  de la ligne (finally), y compris si l'appel échoue, pour réactiver le
   *  bouton "Analyser" — l'erreur elle-même continue de se propager à l'appelant
   *  (auto vs manuel décident chacun quoi en faire). */
  async function runOcrForItem(item) {
    try {
      const bucket = item.kind === 'fuel' ? 'fuel-photos' : 'logbook-photos';
      const result = await analyzeOdometerPhoto({ bucket, storagePath: item.ocrPhotoStoragePath });
      if (item.kind === 'fuel') await saveFuelEventOcrResult(item.id, result);
      else await saveLogbookEntryOcrResult(item.id, result);
      item.ocrKm = result.km;
      item.ocrConfidence = result.confidence;
      item.ocrRawText = result.raw_text;
      item.ocrAnalyzedAt = new Date().toISOString();
    } finally {
      updateRowAfterOcr(item);
    }
  }

  document.querySelectorAll('[data-action="analyze-ocr"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = pending.find((p) => p.kind === btn.dataset.kind && p.id === btn.dataset.id);
      if (!item) return;
      errorEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Analyse…';
      try {
        await runOcrForItem(item);
      } catch (e) {
        errorEl.textContent = e.message || String(e);
        errorEl.hidden = false;
      }
    });
  });

  // Auto, en tâche de fond : jamais plus de OCR_CONCURRENCY appels à la fois, et
  // la table est déjà affichée (pas d'attente) — chaque ligne se met à jour à son
  // tour à mesure que les résultats arrivent. Erreurs juste logguées (pas
  // d'interruption pour une amélioration silencieuse) : analyzeOdometerPhoto ne
  // lève déjà pas pour un échec HTTP de la fonction, seule une panne de
  // sauvegarde DB pourrait remonter ici.
  const needingAutoOcr = pending.filter((item) => item.ocrPhotoStoragePath && !item.ocrAnalyzedAt);
  runWithConcurrencyLimit(needingAutoOcr, OCR_CONCURRENCY, async (item) => {
    try {
      await runOcrForItem(item);
    } catch (e) {
      console.error('[IntelliFleet] OCR auto', item.kind, item.id, e);
    }
  });

  // ---- Zone 2 : indicateurs (ex-#/dashboard), re-rendue seule pour ne jamais
  // toucher aux cases cochées de la zone 1 ----

  function vehicleIdsForScope() {
    if (dashboardState.view === 'vehicle') return dashboardState.vehicleId ? [dashboardState.vehicleId] : [];
    if (dashboardState.view === 'group') {
      const match = groups.find((g) => g.group === dashboardState.group);
      return match ? match.vehicleIds : [];
    }
    return vehicles.map((v) => v.id);
  }

  /** CSV des entrées VALIDÉES de la vue actuellement sélectionnée — réutilise les
   *  données déjà chargées (validatedFuelAll/validatedLogbookAll, mêmes tableaux
   *  que ceux qui alimentent le graphique/les tableaux), pas de requête séparée. */
  function buildCsvForScope(scopeIds) {
    const scopeSet = new Set(scopeIds);
    const vehicleName = (id) => vehicles.find((v) => v.id === id)?.name ?? '';
    const currencyOf = (id) => vehicleCurrency(vehicles.find((v) => v.id === id));

    const rows = [];
    for (const e of validatedFuelAll) {
      if (!scopeSet.has(e.vehicle_id)) continue;
      rows.push([
        'Plein',
        vehicleName(e.vehicle_id),
        e.event_date,
        e.km,
        e.driver_name ?? '',
        e.liters ?? '',
        e.unit_price ?? '',
        e.amount ?? '',
        currencyOf(e.vehicle_id), // montants de devises différentes dans un même fichier
        e.station ?? '',
        '', // commentaire : ne s'applique pas à un plein
      ]);
    }
    for (const e of validatedLogbookAll) {
      if (!scopeSet.has(e.vehicle_id)) continue;
      rows.push([
        'Relevé',
        vehicleName(e.vehicle_id),
        e.event_date,
        e.km,
        e.driver_name ?? '',
        '', // litres/prix unitaire/montant/devise/station : ne s'appliquent pas à un relevé
        '',
        '',
        '',
        '',
        e.comment ?? '',
      ]);
    }
    rows.sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)); // par date croissante

    const header = ['Type', 'Véhicule', 'Date', 'Km', 'Chauffeur', 'Litres', 'Prix unitaire', 'Montant', 'Devise', 'Station', 'Commentaire'];
    return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  function drawDashboardZone() {
    const scopeIds = vehicleIdsForScope();
    const scopeSet = new Set(scopeIds);
    // Compte scopé à la vue sélectionnée : donne une idée de la fiabilité des
    // chiffres du tableau juste en dessous (contrairement à la zone 1, qui reste
    // fleet-wide).
    const validatedCount =
      validatedFuelAll.filter((e) => scopeSet.has(e.vehicle_id)).length +
      validatedLogbookAll.filter((e) => scopeSet.has(e.vehicle_id)).length;
    const pendingScoped = pending.filter((p) => scopeSet.has(p.vehicleId)).length;
    const { monthly, drivers } = buildScopeDashboard(scopeIds, validatedFuelAll, validatedLogbookAll);
    const monthlyAsc = [...monthly].reverse();
    const { currencies, currency, mixed: mixedCurrency } = scopeCurrency(vehicles, scopeIds);

    const zone = document.getElementById('dashboard-zone');
    zone.innerHTML = `
      <p class="dashboard-scope-banner">${validatedCount.toLocaleString('fr-FR')} entrées validées · ${pendingScoped.toLocaleString('fr-FR')} en attente de validation</p>
      ${
        mixedCurrency
          ? `<p class="warning">Devises mixtes (${currencies.join(' + ')}) : coûts non additionnables — voir « Par véhicule » ou un groupe d'une seule devise.</p>`
          : ''
      }

      <div class="dashboard-layout">
        <div class="dashboard-controls">
          <div class="chip-row">
            ${DASHBOARD_VIEWS.map(
              (v) => `<button class="chip ${dashboardState.view === v.key ? 'active' : ''}" data-view="${v.key}">${v.label}</button>`
            ).join('')}
            <button class="btn btn-secondary btn-sm" id="btn-export-csv" type="button">Exporter en CSV</button>
          </div>

          ${
            dashboardState.view === 'vehicle'
              ? `<div class="chip-row">${vehicles
                  .map((v) => `<button class="chip ${dashboardState.vehicleId === v.id ? 'active' : ''}" data-vehicle="${v.id}">${escapeHtml(v.name)}</button>`)
                  .join('')}</div>`
              : ''
          }
          ${
            dashboardState.view === 'group'
              ? `<div class="chip-row">${groups
                  .map(
                    (g) =>
                      `<button class="chip ${dashboardState.group === g.group ? 'active' : ''}" data-group="${escapeHtml(g.group ?? '')}">${escapeHtml(g.group ?? 'Sans groupe')}</button>`
                  )
                  .join('')}</div>`
              : ''
          }
          ${vehicles.length === 0 ? '<p class="empty-text">Aucun véhicule.</p>' : ''}

          <div class="section-label">Évolution mensuelle</div>
          <div class="chip-row">
            <button class="chip ${dashboardState.metric === 'cost' ? 'active' : ''}" data-metric="cost">Coût</button>
            <button class="chip ${dashboardState.metric === 'consumption' ? 'active' : ''}" data-metric="consumption">Consommation</button>
          </div>
          ${dashboardChartSvg(monthlyAsc, dashboardState.metric, mixedCurrency)}
        </div>

        <div class="dashboard-tables">
          <div class="section-label">Détail mensuel</div>
          ${dashboardMonthlyTableHtml(monthly, currency, mixedCurrency)}

          <div class="section-label">Par chauffeur</div>
          ${dashboardDriverTableHtml(drivers)}
        </div>
      </div>
    `;

    zone.querySelector('#btn-export-csv')?.addEventListener('click', () => {
      const csv = buildCsvForScope(scopeIds);
      downloadCsv(csv, `intellifleet-export-${todayIso()}.csv`);
    });

    zone.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.view = btn.dataset.view;
        drawDashboardZone();
      });
    });
    zone.querySelectorAll('[data-vehicle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.vehicleId = btn.dataset.vehicle;
        drawDashboardZone();
      });
    });
    zone.querySelectorAll('[data-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.group = btn.dataset.group || null;
        drawDashboardZone();
      });
    });
    zone.querySelectorAll('[data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.metric = btn.dataset.metric;
        drawDashboardZone();
      });
    });
  }

  drawDashboardZone();
}

// ---------- Service worker : désactivé pendant la phase de debugging actif ----------
// Décision distincte du sujet photo ci-dessus : le mécanisme de mise à jour des
// service workers (latence + caches HTTP navigateur/hébergeur) a produit plusieurs
// épisodes d'appareils bloqués sur une ancienne version après déploiement. Le
// hors-ligne n'est de toute façon pas dans le périmètre de cette tranche. On
// désenregistre activement tout SW existant à chaque chargement — garantit 100%
// réseau. sw.js reste sur le disque, prêt à être réactivé plus tard.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}

// ---------- Démarrage ----------

route();
