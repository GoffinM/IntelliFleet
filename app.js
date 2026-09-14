// IntelliFleet PWA — routing (hash) + 4 écrans, vanilla JS, sans framework.
import { supabase } from './supabase-client.js';
import { checkKmConsistency } from './km-consistency.js';
import {
  PHOTO_TYPES,
  listVehicles,
  listDrivers,
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
} from './api.js';

const ACTIVE_VEHICLE_KEY = 'intellifleet:active_vehicle_id';
const AMOUNT_TOLERANCE_RATIO = 0.005; // 0.5 %
const AMOUNT_TOLERANCE_FLOOR_RWF = 5;

// ---------- Diagnostic capture photo (temporaire) ----------
// Stocké dans sessionStorage (pas juste en mémoire) : si la page se recharge
// silencieusement pendant que l'appli caméra a le premier plan (scénario connu sur
// mobile), le journal survit et s'affiche quand même au retour sur la page — sinon
// on ne verrait jamais la dernière ligne juste avant un éventuel rechargement.
const PHOTO_DIAG_KEY = 'intellifleet:photo-diag-log';

function loadPhotoDiagLog() {
  try {
    return JSON.parse(sessionStorage.getItem(PHOTO_DIAG_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePhotoDiagLog(log) {
  try {
    sessionStorage.setItem(PHOTO_DIAG_KEY, JSON.stringify(log.slice(-30)));
  } catch {
    // best-effort, ne doit jamais casser le flux principal
  }
}

function renderPhotoDiagBanner() {
  let banner = document.getElementById('photo-diag');
  const log = loadPhotoDiagLog();
  if (log.length === 0) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'photo-diag';
    banner.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow:auto;' +
      'background:#111827;color:#facc15;font:11px/1.4 monospace;padding:8px 10px 24px;' +
      'white-space:pre-wrap;z-index:99999;border-top:3px solid #facc15;';
    banner.title = 'Touchez pour effacer ce journal de diagnostic';
    banner.addEventListener('click', () => {
      savePhotoDiagLog([]);
      renderPhotoDiagBanner();
    });
    document.body.appendChild(banner);
  }
  banner.textContent = `DIAGNOSTIC PHOTO (${log.length}, touchez pour effacer) :\n` + log.slice().reverse().join('\n---\n');
}

function showPhotoDiagnostic(message) {
  const time = new Date().toLocaleTimeString('fr-FR');
  const log = loadPhotoDiagLog();
  log.push(`[${time}] ${message}`);
  savePhotoDiagLog(log);
  renderPhotoDiagBanner();
}

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

// ---------- Routing ----------

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  return { segments, query };
}

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

  try {
    if (page === 'login') return renderLogin();
    if (page === 'history') return await renderHistory();
    if (page === 'fuel-event') return await renderFuelEventForm(segments[1] ?? null, query.get('vehicleId'));
    if (page === 'logbook-entry') return await renderLogbookEntryForm(segments[1] ?? null, query.get('vehicleId'));
    return await renderHome();
  } catch (e) {
    setError(e);
  }
}

window.addEventListener('hashchange', route);
supabase.auth.onAuthStateChange(() => route());

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

// ---------- Écran : accueil ----------

async function renderHome() {
  setLoading();
  const vehicles = await listVehicles();
  const activeVehicleId = getActiveVehicleId(vehicles);
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const lastEvent = activeVehicleId ? await getLastFuelEvent(activeVehicleId) : null;

  setContent(`
    <h1>IntelliFleet</h1>

    <div>
      <div class="section-label">Véhicule actif</div>
      <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, activeVehicleId)}</div>
      ${vehicles.length === 0 ? '<p class="empty-text">Aucun véhicule pour ce compte.</p>' : ''}
    </div>

    <div class="link-row">
      <a href="#/history">Historique →</a>
    </div>

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
          <span class="timeline-date">${item.date}</span>
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
    <h1>Historique</h1>
    <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, activeVehicleId)}</div>
    ${items.length === 0 ? '<p class="empty-text">Aucun événement enregistré pour ce véhicule.</p>' : ''}
    <div>${items.map(renderTimelineRow).join('')}</div>
    <a href="#/">← Accueil</a>
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

function photoSlotHtml(type, label, previewUrl, fullWidth) {
  const camId = `photo-${type}-cam`;
  const galId = `photo-${type}-gal`;
  return `
    <div class="photo-slot ${fullWidth ? 'full-width' : ''}" data-type="${type}">
      <span class="slot-label">${escapeHtml(label)}</span>
      ${previewUrl ? `<img src="${previewUrl}" alt="">` : '<div class="placeholder">Aucune photo</div>'}
      <div class="photo-actions">
        <label for="${camId}">${previewUrl ? 'Reprendre' : 'Prendre'}</label>
        <input type="file" accept="image/*" capture="environment" id="${camId}" data-type="${type}">
        <label for="${galId}">Galerie</label>
        <input type="file" accept="image/*" id="${galId}" data-type="${type}">
      </div>
    </div>
  `;
}

function setPhotoSlotPreview(type, url) {
  const slot = document.querySelector(`.photo-slot[data-type="${type}"]`);
  if (!slot) return;
  const existingImg = slot.querySelector('img');
  const placeholder = slot.querySelector('.placeholder');
  if (existingImg) {
    existingImg.src = url;
  } else if (placeholder) {
    const img = document.createElement('img');
    img.src = url;
    placeholder.replaceWith(img);
  }
  const camLabel = slot.querySelector(`label[for="photo-${type}-cam"]`);
  if (camLabel) camLabel.textContent = 'Reprendre';
}

/** Attache les listeners des inputs file d'un ensemble de photo-slots. onPicked(type, file). */
function wirePhotoInputs(container, onPicked) {
  container.querySelectorAll('input[type="file"]').forEach((input) => {
    const type = input.dataset.type;
    const source = input.hasAttribute('capture') ? 'caméra' : 'galerie';

    // Log sur le <label> visible lui-même, AVANT tout ce qui dépend de la relation
    // label -> input caché : vérifie si le tap sur le bouton "Prendre"/"Galerie" est
    // seulement détecté par le DOM, indépendamment de ce que fait ensuite l'input.
    const associatedLabel = container.querySelector(`label[for="${input.id}"]`);
    if (associatedLabel) {
      associatedLabel.addEventListener('click', () => {
        showPhotoDiagnostic(`Tap détecté sur le bouton "${associatedLabel.textContent}" (${type}, ${source}).`);
      });
    } else {
      showPhotoDiagnostic(`AUCUN <label for="${input.id}"> trouvé dans le DOM (${type}, ${source}).`);
    }

    // Log AVANT l'ouverture de l'appli caméra/galerie : si on ne voit jamais la ligne
    // "reçu"/"aucun fichier" qui devrait suivre, ça prouve que la page a perdu son état
    // JS (rechargement silencieux) pendant que la caméra avait le premier plan.
    input.addEventListener('click', () => {
      showPhotoDiagnostic(`Ouverture ${source} (${type})…`);
    });

    input.addEventListener('change', (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        showPhotoDiagnostic(`change reçu (${type}, ${source}) mais AUCUN fichier (files.length=${files ? files.length : 'null'}).`);
        return;
      }
      const file = files[0];
      showPhotoDiagnostic(
        `Photo reçue (${type}, ${source}) :\nnom="${file.name}"\ntaille=${file.size} o\ntype MIME="${file.type}"`
      );
      try {
        const previewUrl = URL.createObjectURL(file);
        setPhotoSlotPreview(type, previewUrl);
      } catch (err) {
        showPhotoDiagnostic(`Erreur création aperçu (${type}) : ${err.name}: ${err.message}`);
      }
      onPicked(type, file);
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
  // Photos : uri affichée (signée si existante, blob: locale si nouvellement choisie) +
  // les fichiers réellement nouveaux à uploader (on ne réuploade jamais un emplacement
  // inchangé).
  const displayedPhotoUrl = {};
  const newPhotoFiles = {};
  if (existing) {
    for (const type of Object.keys(existing.photos)) {
      displayedPhotoUrl[type] = existing.photos[type].signedUrl;
    }
  }

  function currentVehicle() {
    return vehicles.find((v) => v.id === state.vehicleId) ?? null;
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

  setContent(`
    <h1>${editingId ? 'Modifier le plein' : 'Nouveau plein'}</h1>

    <div class="section-label">Photos (optionnelles à la saisie)</div>
    <div class="photo-grid" id="photo-grid">
      ${PHOTO_TYPES.map(({ type, label }) => photoSlotHtml(type, label, displayedPhotoUrl[type] ?? null, false)).join('')}
    </div>

    <div class="section-label">Véhicule</div>
    <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, state.vehicleId)}</div>

    <div class="section-label">Chauffeur (optionnel)</div>
    <div class="chip-row" id="driver-chips">
      <button class="chip ${state.driverId === null ? 'active' : ''}" data-id="">Aucun</button>
      ${drivers.map((d) => `<button class="chip ${state.driverId === d.id ? 'active' : ''}" data-id="${d.id}">${escapeHtml(d.name)}</button>`).join('')}
    </div>

    <div class="section-label">Détails</div>
    <div class="field"><label>Date (AAAA-MM-JJ)</label><input type="date" id="f-date" value="${state.eventDate}"></div>
    <div class="field"><label>Km</label><input type="number" inputmode="numeric" id="f-km" value="${escapeHtml(state.km)}"></div>
    <p class="warning" id="km-warning" hidden></p>
    <div class="field"><label>Litres</label><input type="number" step="0.01" inputmode="decimal" id="f-liters" value="${escapeHtml(state.liters)}"></div>
    <div class="field"><label>Prix unitaire (RWF/L)</label><input type="number" inputmode="numeric" id="f-unit-price" value="${escapeHtml(state.unitPrice)}"></div>
    <div class="field"><label>Montant (RWF)</label><input type="number" inputmode="numeric" id="f-amount" value="${escapeHtml(state.amount)}"></div>
    <p class="warning" id="amount-warning" hidden></p>
    <div class="field"><label>Station</label><input type="text" id="f-station" value="${escapeHtml(state.station)}"></div>
    <div class="field"><label>Notes</label><textarea id="f-notes">${escapeHtml(state.notes)}</textarea></div>

    <p class="error" id="form-error" hidden></p>
    <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
    ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce plein</button>' : ''}
    <a href="#/">← Annuler</a>
  `);

  renderKmWarning();
  renderAmountWarning();

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
    newPhotoFiles[type] = file;
  });

  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('btn-submit');

  submitBtn.addEventListener('click', async () => {
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
          const file = newPhotoFiles[type];
          if (file) {
            await uploadFuelEventPhoto({ fuelEventId: event.id, ownerId: user.id, type, file });
          }
        }
      }

      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
    }
  });

  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce plein ? Cette action est irréversible.')) return;
    try {
      await deleteFuelEvent(editingId);
      location.hash = '#/history';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    }
  });
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
  let newPhotoFile = null;
  const displayedPhotoUrl = existing ? existing.photoSignedUrl : null;

  function currentVehicle() {
    return vehicles.find((v) => v.id === state.vehicleId) ?? null;
  }

  function renderKmWarning() {
    const vehicle = currentVehicle();
    const el = document.getElementById('km-warning');
    if (!el) return;
    const warning = vehicle ? checkKmConsistency(parseInt(state.km, 10), vehicle.current_km) : null;
    el.textContent = warning ?? '';
    el.hidden = !warning;
  }

  setContent(`
    <h1>${editingId ? 'Modifier le relevé' : 'Nouveau relevé'}</h1>

    <div class="section-label">Photo (optionnelle)</div>
    <div class="photo-grid" id="photo-grid">
      ${photoSlotHtml('odometer', 'Compteur', displayedPhotoUrl, true)}
    </div>

    <div class="section-label">Véhicule</div>
    <div class="chip-row" id="vehicle-chips">${vehicleChipsHtml(vehicles, state.vehicleId)}</div>

    <div class="section-label">Chauffeur (optionnel)</div>
    <div class="chip-row" id="driver-chips">
      <button class="chip ${state.driverId === null ? 'active' : ''}" data-id="">Aucun</button>
      ${drivers.map((d) => `<button class="chip ${state.driverId === d.id ? 'active' : ''}" data-id="${d.id}">${escapeHtml(d.name)}</button>`).join('')}
    </div>

    <div class="section-label">Détails</div>
    <div class="field"><label>Date (AAAA-MM-JJ)</label><input type="date" id="f-date" value="${state.eventDate}"></div>
    <div class="field"><label>Km</label><input type="number" inputmode="numeric" id="f-km" value="${escapeHtml(state.km)}"></div>
    <p class="warning" id="km-warning" hidden></p>
    <div class="field"><label>Commentaire (optionnel)</label><textarea id="f-comment">${escapeHtml(state.comment)}</textarea></div>

    <p class="error" id="form-error" hidden></p>
    <button class="btn btn-primary" id="btn-submit">${editingId ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
    ${editingId ? '<button class="btn btn-destructive" id="btn-delete">Supprimer ce relevé</button>' : ''}
    <a href="#/">← Annuler</a>
  `);

  renderKmWarning();

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
    newPhotoFile = file;
  });

  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('btn-submit');

  submitBtn.addEventListener('click', async () => {
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

      if (newPhotoFile) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await uploadLogbookEntryPhoto({ logbookEntryId: entry.id, ownerId: user.id, file: newPhotoFile });
        }
      }

      location.hash = editingId ? '#/history' : '#/';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? 'Enregistrer les modifications' : 'Enregistrer';
    }
  });

  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce relevé ? Cette action est irréversible.')) return;
    try {
      await deleteLogbookEntry(editingId);
      location.hash = '#/history';
    } catch (e) {
      errorEl.textContent = e.message || String(e);
      errorEl.hidden = false;
    }
  });
}

// ---------- Service worker (app shell uniquement, pas de cache des appels Supabase) ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.error('[IntelliFleet] sw register:', e));
  });
}

// ---------- Démarrage ----------

renderPhotoDiagBanner(); // rejoue le journal de diagnostic photo s'il en reste un
route();
