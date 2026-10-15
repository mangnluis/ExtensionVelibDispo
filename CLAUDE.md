# CLAUDE.md — Vélib Advisor

Extension Chrome (Manifest V3, JavaScript vanilla, sans build ni dépendance d'exécution) qui indique si un Vélib vaut le coup pour un trajet dans Paris et la petite couronne : stations proches avec disponibilités en temps réel, durée en Vélib comparée à la marche ou aux transports en commun.

## Commandes

- **Lancer l'extension** : `chrome://extensions` → « Mode développeur » → « Charger l'extension non empaquetée » → racine du dépôt. Après chaque modification : ⟳ sur la carte de l'extension, puis rouvrir la popup.
- **Déboguer la popup** : clic droit dans la popup → « Inspecter ». La popup se ferme dès qu'elle perd le focus, et son état est perdu.
- **Tests unitaires** : `npm test` (Node ≥ 20, aucune dépendance : `node:test`, `fetch` simulé par `tests/helpers.js` → `stubFetch`).
- **Tests de bout en bout** : `npm run test:e2e`. Ils ouvrent la vraie popup dans Chrome headless, avec un réseau simulé par `tests/e2e/fake-api.js`, et prennent ~2 s. Chrome est cherché aux emplacements habituels ; sinon définir `CHROME_PATH`. Les captures d'écran de chaque scénario arrivent dans `tests/e2e/artifacts/` (ignoré par git) : les regarder après toute modification visuelle.

## Architecture

Modules ES : chaque fichier importe explicitement ce qu'il utilise. `lib/` ne touche pas au DOM et se teste sous Node.

| Fichier | Rôle |
|---|---|
| `manifest.json` | MV3, Chrome ≥ 116 (`AbortSignal.any`) ; permissions `geolocation` et `storage` ; accès réseau aux trois API |
| `popup/popup.html` | Interface ; charge `popup.js` en `<script type="module">` |
| `popup/popup.js` | Événements, autocomplétion, rendu des résultats |
| `lib/api.js` | Réseau : stations Vélib, géocodage IGN, itinéraire OpenRouteService, estimation transports en commun ; Haversine |
| `lib/decision.js` | `analyzeVelibJourney` : agrège les appels et décide OUI/NON |
| `lib/geo.js` | `getCurrentPosition` (et `decodePolyline`, inutilisé) |
| `lib/utils.js` | Formatage distance/durée, `debounce`, `escapeHtml` |
| `background/background.js` | Écrit à l'installation des réglages que rien ne lit |
| `tests/unit/*.test.js` | Tests de `lib/`, un fichier par module ; `tests/helpers.js` fournit les réponses d'API simulées |
| `tests/e2e/` | `browser.js` : client CDP minimal (lance Chrome, charge l'extension, pilote un onglet, sert les requêtes HTTPS) ; `popup.test.js` : scénarios |

Déroulé d'une analyse : coordonnées du départ et de l'arrivée (mémorisées si l'adresse vient d'une suggestion ou de la géolocalisation, sinon géocodées) → en parallèle : stations autour du départ, stations autour de l'arrivée, itinéraire vélo, estimation transports → comparaison des durées → affichage.

## API externes

- **Vélib temps réel** (sans clé) — `GET https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records`, requêtes ODSQL (`within_distance(...)`, `distance(...) as dist` en mètres, `order_by=dist`). Champs : `stationcode`, `name`, `numbikesavailable`, `numdocksavailable`, `mechanical`, `ebike`, `capacity`, `is_installed` / `is_renting` / `is_returning` (« OUI » / « NON »), `duedate`, `coordonnees_geo {lat, lon}`.
- **Géocodage IGN Géoplateforme** (sans clé) — `GET https://data.geopf.fr/geocodage/search` et `/reverse`. `lat`/`lon` ne font que pondérer le classement : les résultats couvrent toute la France, d'où le filtre côté client sur les codes postaux 75/92/93/94. `index=address` (par défaut) ne connaît que les adresses ; `index=poi` trouve gares, stations de métro et monuments, mais renvoie `name`, `postcode` et `city` sous forme de tableaux et pas de `label`.
- **OpenRouteService** (clé) — `POST https://api.openrouteservice.org/v2/directions/cycling-regular`, clé dans l'en-tête `Authorization`, quota gratuit limité. En cas d'échec, `calculateRoute` retombe sur une estimation à vol d'oiseau.

## Conventions

- Textes d'interface, commentaires et messages de commit en français.
- JavaScript vanilla, sans framework ni bundler, sans dépendance d'exécution.
- Toute donnée issue d'une API passe par `escapeHtml` (ou `textContent`) avant d'entrer dans le DOM.
- Indentation 2 espaces, fins de ligne LF.

## Pièges connus

- Géocodage (`searchParisArea`) : la saisie brute passe d'abord, car ajouter « Paris » dégrade la recherche des lieux (« République » → 4 km d'écart). Le suffixe ne sert qu'en repli, quand rien n'est trouvé en petite couronne (« Gare de Lyon » sans ville donne d'abord Lyon). À score égal, le lieu dont le nom est exactement la saisie passe en tête.
- Erreurs réseau : `fetchJson` limite chaque requête à 5 s. Les services renvoient un message affichable (« Le service Vélib ne répond pas… »), sauf OpenRouteService qui retombe sur une estimation. Une adresse introuvable lève `AddressNotFoundError`, à distinguer d'une panne.
- Sous Node, le minuteur d'`AbortSignal.timeout` ne retient pas le processus : un test qui n'attend que lui doit garder la boucle d'événements occupée (voir `fetchJson` dans `api.test.js`).
- Pour tester le géocodeur à la main sous Windows, passer par Node (`fetch`), pas par `curl` dans Git Bash : il transmet les accents dans le mauvais encodage (« Opéra » ne trouve alors rien).
- Les distances aux stations sont à vol d'oiseau ; la vitesse de marche de 1,2 m/s intègre les détours.
- Chrome (version de marque) ignore `--load-extension` depuis la v137. Pour piloter l'extension en headless : `--remote-debugging-pipe --enable-unsafe-extension-debugging`, puis la commande CDP `Extensions.loadUnpacked`.

---

## Améliorations à apporter

Analyse du 15/10/2026 (commit `5f6f9b3`), faite en lisant tout le code, en interrogeant les trois API et en pilotant la popup dans Chrome headless.

Méthode : un élément (ou un petit groupe cohérent) par itération. Écrire d'abord le test qui révèle le problème, corriger, lancer les tests, cocher la case ici, puis commiter avec un message `<ID> : <résumé>`.

### 🔴 P0 — Bugs

- [x] **B1 — Plantage à chaque recommandation « OUI ».** `popup.js` → `displayResults` lit `result.duration.velibText`, une propriété qu'`analyzeVelibJourney` n'a jamais renvoyée (elle renvoie `totalDuration`, et `alternative: null` quand le Vélib l'emporte). Reproduit dans la vraie popup avec Hôtel de Ville → Gare de Lyon : alerte « Cannot read properties of undefined (reading 'velibText') ». Le cas principal de l'extension est cassé depuis le commit `7a0d648` (avril 2025). *Correctif* : renvoyer la durée Vélib et l'alternative dans tous les cas, puis les afficher.
- [x] **B2 — Stations hors service proposées.** `getNearbyVelibStations` ignore `is_installed`, `is_renting` et `is_returning`. Le 15/10/2026, 18 stations étaient hors service, dont 2 annonçaient encore des vélos (données figées depuis 2025). *Correctif* : demander ces champs, ne garder que les stations qui louent (départ) ou qui acceptent les retours (arrivée). Les données périmées ne concernent que ces stations : aucun filtre sur `duedate` n'est nécessaire.
- [x] **B3 — Géocodage faux sur les lieux les plus courants.** Seul l'index `address` est interrogé, donc les gares et stations de métro deviennent des rues homonymes : « Gare du Nord » → « Port de la Gare 75013 » (**5,4 km d'écart**), « Châtelet » → « Passage Châtelet 75017 » (4,6 km), « Gare de Lyon » → « Rue de Lyon » (690 m). Pire : « Stade de France » → 610 km, « Mairie de Montreuil » → 272 km. *Correctif* : `index=address,poi`, saisie brute avant l'ajout de « Paris », nom exact en tête, rien hors de Paris et de la petite couronne. Sur 22 lieux parisiens, 21 tombent à moins de 300 m (contre 10 avant).
- [x] **B4 — Bouton « Détecter ma position » invisible.** Son icône `assets/icons/location.svg` n'existe pas dans le dépôt, et le bouton est en `position: absolute` sans `top`. Seul « 📍 Coordonnées exactes » est visible. *Correctif* : icône SVG versionnée, bouton placé dans le champ Départ.
- [x] **B5 — Une panne réseau se fait passer pour « aucune station ».** `getNearbyVelibStations` avale l'erreur et renvoie `[]` : API Vélib indisponible ou délai dépassé → « Aucune station Vélib disponible près de votre point de départ ». *Correctif* : propager l'erreur, afficher « données Vélib indisponibles, réessayez ».
- [x] **B6 — Deux timeouts de 5 s en concurrence.** `decision.js` → `withTimeout(…, 5000)` enveloppe des appels déjà limités à 5 s par `fetchJson`. Un OpenRouteService lent peut faire échouer toute l'analyse au lieu de basculer sur l'estimation prévue. `withTimeout` enveloppe aussi `getTransportAlternatives`, qui n'est même pas asynchrone. *Correctif* : un seul niveau de timeout, dans `fetchJson`.
- [x] **B7 — CSS invalide** `font-size: C;` sur les champs texte (`popup.css`).

### 🟠 P1 — Justesse des calculs

- [ ] **C1 — Marche plafonnée à 5 min.** `velibTime` ajoute `Math.min(walkDuration, 300)` alors que la station retenue peut être à 1 km (~14 min) : les recommandations sont trop optimistes. Le détail affiché ne correspond pas au total, car il montre la marche non plafonnée et « prise/dépose 2 min » même quand 1 min est comptée (trajets < 2 km).
- [ ] **C2 — Estimation de secours incohérente.** `calculateRoute` multiplie la distance par 1,2, mais calcule la durée sur la distance à vol d'oiseau à 20 km/h. OpenRouteService mesure environ 16 km/h dans Paris. *Correctif* : durée = distance estimée / 15 km/h.
- [ ] **C3 — Constantes contradictoires.** La marche est à 1,2 m/s dans `api.js` et à 1,4 m/s dans `decision.js`. L'alternative « trajet trop long » est à 18 km/h au lieu de passer par `getTransportAlternatives` (30 km/h + attente + marche). *Correctif* : toutes les constantes métier dans `lib/config.js`.
- [ ] **C4 — Même station au départ et à l'arrivée.** Sur un trajet court, la station la plus proche peut être la même aux deux bouts : l'extension propose de prendre un vélo pour le reposer au même endroit.
- [ ] **C5 — Formatage.** `formatDuration` : 59 s → « 0min », 65 min → « 1h5 » (à lire « 1 h 05 »). `formatDistance` : point décimal anglais (« 1.5km »).
- [ ] **C6 — Validation des coordonnées.** Le test `!origin.lat` rejette 0 et accepte des chaînes : utiliser `Number.isFinite`.

### 🟡 P1 — Qualité du code

- [x] **Q1 — Scripts globaux à ordre implicite.** Cinq `<script>` dans `popup.html`, dépendances invisibles (`decision.js` appelle `calculateHaversineDistance` défini dans `api.js`, etc.), rien de testable. *Correctif* : modules ES (`import`/`export`, `<script type="module">`).
- [ ] **Q2 — Code mort.** `decodePolyline` (la géométrie n'est plus demandée), `setStorageData` et `getStorageData`, `CONFIG.DECISION_THRESHOLD`, `CONFIG.VELIB_SPEED_FACTOR` (= 1), `safeGet` (générique pour lire une propriété), la JSDoc orpheline de Haversine dans `geo.js`, et `background.js` (réglages jamais lus) avec la permission `storage` qui ne sert qu'à lui.
- [ ] **Q3 — Haversine au mauvais endroit.** `calculateHaversineDistance` est dans `api.js` : la déplacer dans `geo.js`.
- [ ] **Q4 — Outils de debug livrés aux utilisateurs.** Le bouton « Vérifier les stations » s'active via un ID d'extension codé en dur, propre au chemin de la machine (`location.hostname === 'localhost'` n'est jamais vrai dans une popup). Le lien « Voir toutes les stations » écrit dans la console puis ouvre une `alert`. Des `console.log` de debug subsistent dans `popup.js` et `decision.js`.
- [x] **Q5 — Bouton « Coordonnées exactes ».** Il est créé en JavaScript (avec des commentaires d'assistant du type « Ajouter cette ligne… ») et écrase le presse-papier sans le demander. Il fait doublon avec « Détecter ma position » depuis que les coordonnées détectées sont mémorisées.
- [ ] **Q6 — Rendu dupliqué.** Les listes départ et arrivée sont générées par deux blocs copiés-collés, en concaténant du `innerHTML`. *Correctif* : une seule fonction, avec `textContent`.
- [x] **Q7 — `fetchJson`.** Un signal externe déjà annulé est ignoré, et l'écouteur `abort` n'est jamais retiré. *Correctif* : `AbortSignal.any` + `AbortSignal.timeout`.
- [ ] **Q8 — Clé OpenRouteService codée en dur** au milieu de `calculateRoute`. *Correctif* : la déplacer dans la configuration (voir aussi L3).
- [ ] **Q9 — CSS.** `.hidden` et `.input-group` sont déclarés deux fois. La police Roboto n'est jamais chargée. La largeur des suggestions (`calc(100% - 32px)`) est fausse. L'indentation est incohérente, et le commentaire résiduel « Ajouter ces styles à la fin du fichier CSS » traîne encore.

### 🔵 P2 — Expérience utilisateur et accessibilité

- [ ] **U1 — `alert()` pour toutes les erreurs** : les remplacer par un message dans la popup.
- [ ] **U2 — Clavier.** Entrée ne lance pas l'analyse (pas de `<form>`). Les suggestions ne se parcourent pas au clavier (↑ ↓ Entrée Échap) et n'ont pas de rôle ARIA. Sans `autocomplete="off"`, l'autoremplissage du navigateur recouvre les suggestions.
- [ ] **U3 — Double clic sur « Analyser ».** Deux analyses tournent en parallèle et la plus lente écrase l'autre. Désactiver le bouton pendant le calcul.
- [ ] **U4 — Contrastes insuffisants.** Vert `#4CAF50` sur blanc : 2,8:1 (bouton principal, « OUI », disponibilités). Orange : 2:1. Le minimum WCAG AA est de 4,5:1.
- [ ] **U5 — « Nouvelle recherche »** se contente de masquer les résultats.
- [ ] **U6 — Estimation non signalée.** Quand OpenRouteService échoue, la durée vélo est une estimation, mais rien ne l'indique (le champ `estimated` n'est jamais lu).
- [ ] **U7 — Pas de mode sombre** (`prefers-color-scheme`).

### 🟢 P2 — Fonctionnalités

- [ ] **F1 — Vélos mécaniques et électriques.** L'API fournit `mechanical` et `ebike`, l'interface n'affiche qu'un total.
- [ ] **F2 — Mémoriser la dernière recherche.** La popup repart de zéro à chaque ouverture.
- [ ] **F3 — Bouton d'inversion départ ⇄ arrivée** pour le trajet retour.
- [ ] **F4 — Liste complète des stations dans la popup** (remplace le lien console de Q4).

### ⚡ P2 — Performances

- [ ] **P1 — Requête stations surdimensionnée.** `limit: 30` alors que 3 stations sont affichées par côté.
- [ ] **P2 — Appels en cascade.** Les stations du départ attendent la fin du géocodage de l'arrivée (et inversement). Chaque côté peut enchaîner dès que ses propres coordonnées sont connues.

### 🧪 Tests et outillage

- [x] **T1 — Tests unitaires** de `lib/` avec `node:test`, sans dépendance, `fetch` simulé : `npm test`.
- [x] **T2 — Tests de bout en bout.** La vraie popup dans Chrome headless (protocole CDP par pipe, réseau simulé par le domaine `Fetch`) : `npm run test:e2e`.
- [x] **T3 — Fichiers de projet** : `package.json` (scripts uniquement), `.gitignore`, `.editorconfig`, `.gitattributes` (LF imposé).

### 📝 Documentation

- [ ] **D1 — README obsolète.** Il annonce Nominatim (OpenStreetMap) alors que le géocodage passe par l'IGN, et n'explique ni comment développer ni comment tester.

### ⏳ Plus tard — décision ou action du propriétaire nécessaire

- **L1** — Temps réel en transports en commun via l'API PRIM d'Île-de-France Mobilités (clé gratuite), au lieu d'une vitesse moyenne.
- **L2** — Itinéraire vélo calculé entre les stations retenues plutôt qu'entre l'origine et la destination ; profil `cycling-electric` quand seuls des vélos électriques sont disponibles.
- **L3** — Clé OpenRouteService publique dans le code et dans l'historique git : la régénérer en cas d'abus. À terme : proxy serveur, ou clé personnelle saisie dans une page d'options.
- **L4** — Version Firefox (`browser_specific_settings`, `background.scripts`).
- **L5** — Publication sur le Chrome Web Store : archive sans tests ni outils, politique de confidentialité (exigée pour la géolocalisation), fichier LICENSE.
- **L6** — Intégration continue (GitHub Actions) lançant `npm test`.
- **L7** — Prévenir quand le trajet dépasse la durée incluse dans l'abonnement Vélib.
