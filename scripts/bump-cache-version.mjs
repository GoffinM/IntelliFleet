#!/usr/bin/env node
// Anti-cache PWA — à lancer avant CHAQUE déploiement, puis committer les fichiers
// modifiés. Aucune étape de build : ce script fait juste un remplacement de texte
// dans les fichiers sources, qui restent servis tels quels.
//
// Pourquoi : un import ES relatif (import { x } from './api.js') est une URL à part
// entière pour le cache du navigateur. Rafraîchir app.js seul (ex. via un ?v= sur le
// tag <script>) ne force PAS le rechargement de ./api.js/./dashboard.js/etc. que
// app.js importe en interne — ils peuvent rester servis depuis une ancienne version
// en cache. La solution : le même paramètre ?v=<version> partout (index.html ET
// chaque import local dans app.js/api.js), un seul geste pour tout mettre à jour.
//
// Usage : node scripts/bump-cache-version.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function newVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const version = newVersion();
// Les seuls fichiers qui référencent un autre fichier local (via <script>/<link> ou
// import) — dashboard.js et km-consistency.js n'importent rien eux-mêmes, ils n'ont
// donc pas besoin d'être dans cette liste, seulement d'être RÉFÉRENCÉS avec ?v= par
// les fichiers ci-dessous.
const files = ['index.html', 'app.js', 'api.js'];

let totalReplacements = 0;
for (const name of files) {
  const path = join(root, name);
  const before = readFileSync(path, 'utf8');
  const matches = before.match(/\?v=[A-Za-z0-9_-]+/g) ?? [];
  const after = before.replace(/\?v=[A-Za-z0-9_-]+/g, `?v=${version}`);
  if (matches.length === 0) {
    console.warn(`⚠ ${name} : aucun "?v=" trouvé — vérifie que ses références locales sont bien versionnées.`);
    continue;
  }
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`${name} : ${matches.length} référence(s) mise(s) à jour`);
    totalReplacements += matches.length;
  }
}

console.log(`\nNouvelle version : ${version} (${totalReplacements} référence(s) au total)`);
console.log("N'oublie pas de committer les fichiers modifiés.");
