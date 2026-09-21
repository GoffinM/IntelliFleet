// IntelliFleet PWA — routing (hash) + 4 écrans, vanilla JS, sans framework.
import { supabase } from './supabase-client.js';
import { checkKmConsistency } from './km-consistency.js';
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
} from './api.js';
import { buildScopeDashboard, groupVehiclesByFleetGroup, formatMonthLabel } from './dashboard.js';

const ACTIVE_VEHICLE_KEY = 'intellifleet:active_vehicle_id';
const AMOUNT_TOLERANCE_RATIO = 0.005; // 0.5 %
const AMOUNT_TOLERANCE_FLOOR_RWF = 5;

// ---------- Helpers génériques ----------

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

function computeAmountWarning(liters, unitPrice, amount) {
  const l = parseFloat(liters);
  const p = parseFloat(unitPrice);
  const a = parseFloat(amount);
  if (!l || !p || !a) return null;
  const expected = l * p;
  const diff = Math.abs(a - expected);
  const threshold = Math.max(AMOUNT_TOLERANCE_FLOOR_RWF, expected * AMOUNT_TOLERANCE_RATIO);
  if (diff > threshold) {
    return `Montant inhabituel : litres × prix ≈ ${Math.round(expected).toLocaleString('fr-FR')} RWF, saisi ${Math.round(a).toLocaleString('fr-FR')} RWF.`;
  }
  return null;
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
function topBarHtml(title, { showBack = true } = {}) {
  return `
    <div class="top-bar">
      ${showBack ? '<a href="#/" class="top-bar-back">← Accueil</a>' : ''}
      <h1 class="top-bar-title">${escapeHtml(title)}</h1>
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

const ADMIN_ONLY_PAGES = ['vehicle-form', 'driver-form', 'validation', 'dashboard'];

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
    if (page === 'dashboard') return await renderDashboard();
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
  const [vehicles, pendingCount] = await Promise.all([listVehicles(), isAdmin ? countUnvalidatedEntries() : Promise.resolve(0)]);
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
          <a href="#/validation">Validation${pendingCount > 0 ? ` (${pendingCount})` : ''}</a>
          <a href="#/dashboard">Tableau de bord</a>
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
              <p class="timeline-line">${lastEvent.liters} L · ${lastEvent.amount.toLocaleString('fr-FR')} RWF</p>
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
  document.getElementById('btn-logout').addEventListener('click', () => supabase.auth.signOut());
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
  }));
  return [...fuelItems, ...logbookItems].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

function renderTimelineRow(item) {
  const kindLabel = item.kind === 'fuel' ? 'Plein' : 'Relevé';
  const detailLines =
    item.kind === 'fuel'
      ? `
        <span class="timeline-line">${item.liters} L · ${item.amount.toLocaleString('fr-FR')} RWF</span>
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

  setContent(`
    ${topBarHtml('Historique')}
    <div class="screen-wide">
    <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, activeVehicleId)}</div>
    ${items.length === 0 ? '<p class="empty-text">Aucun événement enregistré pour ce véhicule.</p>' : ''}
    <div class="timeline-list">${items.map(renderTimelineRow).join('')}</div>
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

/** Attache les listeners des inputs file d'un ensemble de photo-slots. onPicked(type, file). */
function wirePhotoInputs(container, onPicked) {
  container.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      onPicked(input.dataset.type, file);
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
    unitPrice: existing ? String(existing.unit_price) : '',
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
      <div class="field"><label>Litres</label><input type="number" step="0.01" inputmode="decimal" id="f-liters" value="${escapeHtml(state.liters)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Prix unitaire (RWF/L)</label><input type="number" inputmode="numeric" id="f-unit-price" value="${escapeHtml(state.unitPrice)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Montant (RWF)</label><input type="number" inputmode="numeric" id="f-amount" value="${escapeHtml(state.amount)}" ${locked ? 'disabled' : ''}></div>
      <p class="warning" id="amount-warning" hidden></p>
      <div class="field"><label>Station</label><input type="text" id="f-station" value="${escapeHtml(state.station)}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label>Notes</label><textarea id="f-notes" ${locked ? 'disabled' : ''}>${escapeHtml(state.notes)}</textarea></div>

      <p class="error" id="form-error" hidden></p>
      ${
        locked
          ? ''
          : `
      <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
      ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce plein</button>' : ''}
      `
      }
      </div>
    `);

    renderKmWarning();
    renderAmountWarning();

    if (locked) return; // aucun listener d'édition à attacher, tout est en lecture seule

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
    });
    document.getElementById('f-liters').addEventListener('input', (e) => {
      state.liters = e.target.value;
      renderAmountWarning();
    });
    document.getElementById('f-unit-price').addEventListener('input', (e) => {
      state.unitPrice = e.target.value;
      renderAmountWarning();
    });
    document.getElementById('f-amount').addEventListener('input', (e) => {
      state.amount = e.target.value;
      renderAmountWarning();
    });
    document.getElementById('f-station').addEventListener('input', (e) => (state.station = e.target.value));
    document.getElementById('f-notes').addEventListener('input', (e) => (state.notes = e.target.value));

    wirePhotoInputs(document.getElementById('photo-grid'), (type, file) => {
      photoState[type] = { ...photoState[type], file, previewUrl: URL.createObjectURL(file) };
      renderForm();
    });

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
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

  function renderAmountWarning() {
    const el = document.getElementById('amount-warning');
    if (!el) return;
    const warning = computeAmountWarning(state.liters, state.unitPrice, state.amount);
    el.textContent = warning ?? '';
    el.hidden = !warning;
  }

  async function handleSubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('btn-submit');
    errorEl.hidden = true;
    if (!state.vehicleId) {
      errorEl.textContent = 'Sélectionne un véhicule.';
      errorEl.hidden = false;
      return;
    }
    const kmNum = parseInt(state.km, 10);
    const litersNum = parseFloat(state.liters);
    const unitPriceNum = parseInt(state.unitPrice, 10);
    const amountNum = parseInt(state.amount, 10);
    if (!state.eventDate || Number.isNaN(kmNum) || Number.isNaN(litersNum) || Number.isNaN(unitPriceNum) || Number.isNaN(amountNum)) {
      errorEl.textContent = 'Vérifie la date, le km, les litres, le prix unitaire et le montant.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement…';
    try {
      const input = {
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

      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
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
  };
  const originalPhotoUrl = existing ? existing.photoSignedUrl : null;
  const photo = { file: null, previewUrl: originalPhotoUrl };

  // Verrou de validation (0005_fleet_multi_user.sql), même principe que le formulaire
  // de plein.
  const locked = !!(existing?.validated_at) && currentProfile?.role !== 'admin';

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
      <div class="field"><label>Commentaire (optionnel)</label><textarea id="f-comment" ${locked ? 'disabled' : ''}>${escapeHtml(state.comment)}</textarea></div>

      <p class="error" id="form-error" hidden></p>
      ${
        locked
          ? ''
          : `
      <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
      ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce relevé</button>' : ''}
      `
      }
      </div>
    `);

    renderKmWarning();

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
    });
    document.getElementById('f-comment').addEventListener('input', (e) => (state.comment = e.target.value));

    wirePhotoInputs(document.getElementById('photo-grid'), (_type, file) => {
      photo.file = file;
      photo.previewUrl = URL.createObjectURL(file);
      renderForm();
    });

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
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

  async function handleSubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('btn-submit');
    errorEl.hidden = true;
    if (!state.vehicleId) {
      errorEl.textContent = 'Sélectionne un véhicule.';
      errorEl.hidden = false;
      return;
    }
    const kmNum = parseInt(state.km, 10);
    if (!state.eventDate || Number.isNaN(kmNum)) {
      errorEl.textContent = 'Vérifie la date et le km.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement…';
    try {
      const input = {
        vehicleId: state.vehicleId,
        driverId: state.driverId,
        km: kmNum,
        eventDate: state.eventDate,
        comment: state.comment.trim() || null,
      };
      const entry = editingId ? await updateLogbookEntry(editingId, input) : await createLogbookEntry(input);

      if (photo.file) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await uploadLogbookEntryPhoto({ logbookEntryId: entry.id, ownerId: user.id, file: photo.file });
        }
      }

      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
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
    <div class="field"><label>Groupe de flotte (optionnel)</label><input type="text" id="f-fleet-group" placeholder="ex. Privés, SHER Rwanda, SHER Burundi"></div>
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
    const fleetGroupRaw = document.getElementById('f-fleet-group').value.trim();
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

// ---------- Écran : validation (admin only) ----------

function validationRowHtml(item) {
  const kindLabel = item.kind === 'fuel' ? 'Plein' : 'Relevé';
  const isValidated = !!item.validatedAt;
  const thumbs = item.photos.map((p) => `<img class="validation-thumb" src="${p.signedUrl}" alt="${escapeHtml(p.type)}">`).join('');
  return `
    <div class="card">
      <div class="timeline-header">
        <p class="card-title">${kindLabel} · ${escapeHtml(item.vehicleName)}</p>
        <span class="badge ${isValidated ? 'badge-validated' : 'badge-pending'}">${isValidated ? 'Validé' : 'Non validé'}</span>
      </div>
      <p class="card-subtitle">${item.date} · ${item.km.toLocaleString('fr-FR')} km${item.driverName ? ` · ${escapeHtml(item.driverName)}` : ''}</p>
      ${item.kind === 'fuel' ? `<p class="timeline-line">${item.liters} L · ${item.amount.toLocaleString('fr-FR')} RWF</p>` : ''}
      ${thumbs ? `<div class="validation-thumbs">${thumbs}</div>` : '<p class="empty-text">Aucune photo.</p>'}
      <div class="btn-row">
        ${!isValidated ? `<button class="btn btn-primary" data-action="validate" data-kind="${item.kind}" data-id="${item.id}">Valider</button>` : ''}
        ${isValidated && item.photos.length > 0 ? `<button class="btn btn-destructive" data-action="delete-photos" data-kind="${item.kind}" data-id="${item.id}">Supprimer les photos</button>` : ''}
      </div>
    </div>
  `;
}

async function renderValidation() {
  setLoading();
  const [pendingFuel, pendingLogbook, doneFuel, doneLogbook] = await Promise.all([
    listUnvalidatedFuelEvents(),
    listUnvalidatedLogbookEntries(),
    listRecentlyValidatedFuelEvents(),
    listRecentlyValidatedLogbookEntries(),
  ]);
  const byDateDesc = (a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);
  const pending = [...pendingFuel, ...pendingLogbook].sort(byDateDesc);
  const done = [...doneFuel, ...doneLogbook].sort(byDateDesc);

  setContent(`
    ${topBarHtml('Validation')}
    <div class="screen-wide">
    <p class="error" id="validation-error" hidden></p>

    <div class="section-label">À valider (${pending.length})</div>
    ${pending.length === 0 ? '<p class="empty-text">Rien à valider.</p>' : `<div class="card-grid">${pending.map(validationRowHtml).join('')}</div>`}

    <div class="section-label">Validées récemment</div>
    ${done.length === 0 ? '<p class="empty-text">Aucune entrée validée récemment.</p>' : `<div class="card-grid">${done.map(validationRowHtml).join('')}</div>`}
    </div>
  `);

  const errorEl = document.getElementById('validation-error');

  document.querySelectorAll('[data-action="validate"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      errorEl.hidden = true;
      btn.disabled = true;
      try {
        if (btn.dataset.kind === 'fuel') await validateFuelEvent(btn.dataset.id);
        else await validateLogbookEntry(btn.dataset.id);
        await renderValidation();
      } catch (e) {
        errorEl.textContent = e.message || String(e);
        errorEl.hidden = false;
        btn.disabled = false;
      }
    });
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
}

// ---------- Écran : tableau de bord (admin only) ----------

const DASHBOARD_VIEWS = [
  { key: 'vehicle', label: 'Par véhicule' },
  { key: 'group', label: 'Par groupe' },
  { key: 'total', label: 'Total flotte' },
];

// État local de l'écran (vue + sélection + métrique du graphique). Pas de persistance
// (localStorage) volontaire : contrairement au véhicule actif de l'accueil, ce choix
// n'a pas besoin de survivre à une navigation ailleurs puis un retour.
let dashboardState = null;

function dashboardChartSvg(monthlyAsc, metric) {
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

function dashboardMonthlyTableHtml(monthly) {
  if (monthly.length === 0) return '<p class="empty-text">Aucune donnée validée pour cette sélection.</p>';
  const rows = monthly
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(formatMonthLabel(r.month))}</td>
      <td>${r.km.toLocaleString('fr-FR')}</td>
      <td>${r.liters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
      <td>${Math.round(r.amount).toLocaleString('fr-FR')}</td>
      <td>${r.costPerKm != null ? Math.round(r.costPerKm).toLocaleString('fr-FR') : '—'}</td>
      <td>${r.litersPer100km != null ? r.litersPer100km.toFixed(1) : '—'}</td>
    </tr>
  `
    )
    .join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Mois</th><th>Km</th><th>Litres</th><th>Coût</th><th>Coût/km</th><th>L/100km</th></tr></thead>
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

async function renderDashboard() {
  setLoading();
  const [vehicles, fuelEvents, logbookEntries] = await Promise.all([
    listVehicles(),
    listValidatedFuelEventsAll(),
    listValidatedLogbookEntriesAll(),
  ]);
  const groups = groupVehiclesByFleetGroup(vehicles);

  if (!dashboardState) {
    dashboardState = {
      view: 'vehicle',
      vehicleId: vehicles[0]?.id ?? null,
      group: groups[0]?.group ?? null,
      metric: 'cost',
    };
  }

  function vehicleIdsForScope() {
    if (dashboardState.view === 'vehicle') return dashboardState.vehicleId ? [dashboardState.vehicleId] : [];
    if (dashboardState.view === 'group') {
      const match = groups.find((g) => g.group === dashboardState.group);
      return match ? match.vehicleIds : [];
    }
    return vehicles.map((v) => v.id);
  }

  function draw() {
    const { monthly, drivers } = buildScopeDashboard(vehicleIdsForScope(), fuelEvents, logbookEntries);
    const monthlyAsc = [...monthly].reverse();

    setContent(`
      ${topBarHtml('Tableau de bord')}
      <div class="screen-dashboard">
      <div class="dashboard-layout">
        <div class="dashboard-controls">
          <div class="chip-row">
            ${DASHBOARD_VIEWS.map(
              (v) => `<button class="chip ${dashboardState.view === v.key ? 'active' : ''}" data-view="${v.key}">${v.label}</button>`
            ).join('')}
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
          ${dashboardChartSvg(monthlyAsc, dashboardState.metric)}
        </div>

        <div class="dashboard-tables">
          <div class="section-label">Détail mensuel</div>
          ${dashboardMonthlyTableHtml(monthly)}

          <div class="section-label">Par chauffeur</div>
          ${dashboardDriverTableHtml(drivers)}
        </div>
      </div>
      </div>
    `);

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.view = btn.dataset.view;
        draw();
      });
    });
    document.querySelectorAll('[data-vehicle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.vehicleId = btn.dataset.vehicle;
        draw();
      });
    });
    document.querySelectorAll('[data-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.group = btn.dataset.group || null;
        draw();
      });
    });
    document.querySelectorAll('[data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dashboardState.metric = btn.dataset.metric;
        draw();
      });
    });
  }

  draw();
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
