/**
 * Module de gestion des requêtes API
 */

import { formatDistance, formatDuration } from './utils.js';
import { getCurrentPosition } from './geo.js';

const GEOCODE_API = 'https://data.geopf.fr/geocodage';
const VELIB_API = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records';
const PARIS_CENTER = { lat: 48.856614, lng: 2.3522219 };
const PARIS_AREA_POSTCODE = /^(75|92|93|94)/;

const geocodeCache = new Map();

/**
 * fetch + JSON avec timeout (et annulation externe optionnelle)
 */
export function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  return fetch(url, { ...options, signal: controller.signal })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    })
    .finally(() => clearTimeout(timeoutId));
}

/**
 * Récupère les stations Vélib à proximité d'une position
 *
 * @param {Object} position - {lat: number, lng: number}
 * @param {number} radius - Rayon de recherche en mètres
 * @returns {Promise<Array>} - Stations trouvées, triées par distance
 */
export function getNearbyVelibStations(position, radius = 1500) {
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    return Promise.reject(new Error("Position invalide"));
  }

  const distanceFromParis = calculateHaversineDistance(position.lat, position.lng, PARIS_CENTER.lat, PARIS_CENTER.lng);
  if (distanceFromParis > 3000) {
    radius = Math.max(radius, 2000);
  }

  const point = `geom'POINT(${position.lng} ${position.lat})'`;
  const params = new URLSearchParams({
    select: `stationcode,name,numbikesavailable,numdocksavailable,is_installed,is_renting,is_returning,coordonnees_geo,distance(coordonnees_geo,${point}) as dist`,
    where: `within_distance(coordonnees_geo,${point},${radius}m)`,
    order_by: 'dist',
    limit: 30
  });

  return fetchJson(`${VELIB_API}?${params}`)
    .then(data => {
      return (data.results || []).map(station => {
        const distanceWalk = station.dist || 0;
        const walkDuration = Math.round(distanceWalk / 1.2);
        const installed = station.is_installed === 'OUI';

        return {
          id: station.stationcode,
          name: station.name,
          bikes: station.numbikesavailable || 0,
          docks: station.numdocksavailable || 0,
          renting: installed && station.is_renting === 'OUI',
          returning: installed && station.is_returning === 'OUI',
          lat: station.coordonnees_geo.lat,
          lng: station.coordonnees_geo.lon,
          distance: distanceWalk,
          distanceText: formatDistance(distanceWalk),
          walkDuration: walkDuration,
          durationText: formatDuration(walkDuration)
        };
      });
    })
    .catch(error => {
      console.error("Erreur lors de la récupération des stations:", error);
      return [];
    });
}

/**
 * Convertit une feature GeoJSON de l'API IGN en objet adresse
 */
export function featureToAddress(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return {
    display_name: feature.properties.label,
    lat: lat,
    lng: lng,
    type: feature.properties.type,
    postcode: feature.properties.postcode || ''
  };
}

const PARIS_AREA_CITIES = /paris|boulogne|neuilly|levallois|issy|vanves|malakoff|montrouge|gentilly|ivry|charenton|saint-mand[ée]|saint-ouen|clichy|puteaux|montreuil|pantin|aubervilliers|\b(75|92|93|94)\d{3}\b/i;

/**
 * Recherche d'adresses via le géocodeur IGN (Géoplateforme)
 */
export function geocodeSearch(query, { limit = 1, autocomplete = false, signal } = {}) {

  const cacheKey = `${query}|${limit}|${autocomplete}`;
  if (geocodeCache.has(cacheKey)) {
    return Promise.resolve(geocodeCache.get(cacheKey));
  }

  const params = new URLSearchParams({
    q: query,
    limit: limit,
    lat: PARIS_CENTER.lat,
    lon: PARIS_CENTER.lng,
    autocomplete: autocomplete ? 1 : 0
  });

  return fetchJson(`${GEOCODE_API}/search?${params}`, { signal })
    .then(data => {
      const results = (data.features || []).map(featureToAddress);
      geocodeCache.set(cacheKey, results);
      return results;
    });
}

export function getCoordinates(address) {
  if (!address || address === 'Ma position' || address === 'Position actuelle') {
    return getCurrentPosition().catch(error => {
      console.error('Erreur de géolocalisation:', error);
      throw new Error('Impossible de déterminer votre position actuelle');
    });
  }

  // Coordonnées saisies directement ("48.85, 2.35")
  const coordsMatch = address.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordsMatch) {
    return Promise.resolve({ lat: parseFloat(coordsMatch[1]), lng: parseFloat(coordsMatch[2]) });
  }

  // Sans ville précisée, on cherche dans Paris ("Gare de Lyon" ne doit pas mener à Lyon)
  const query = PARIS_AREA_CITIES.test(address) || address.includes(',') ? address : `${address} Paris`;

  return geocodeSearch(query, { limit: 5 })
    .then(results => {
      if (results.length === 0) {
        throw new Error(`Adresse introuvable: ${address}`);
      }
      // Privilégier un résultat à Paris / petite couronne
      const best = results.find(r => PARIS_AREA_POSTCODE.test(r.postcode)) || results[0];
      return { lat: best.lat, lng: best.lng };
    });
}

export function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({ lat: lat, lon: lng, limit: 1 });

  return fetchJson(`${GEOCODE_API}/reverse?${params}`)
    .then(data => {
      if (!data.features || data.features.length === 0) {
        throw new Error('Adresse introuvable');
      }
      return data.features[0].properties.label;
    });
}

export function calculateRoute(origin, destination, profile = 'cycling-regular') {
  if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }

  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  const estimatedDuration = Math.round(directDistance / 5.56);

  const routeFactor = 1.2;
  const estimatedRealDistance = directDistance * routeFactor;
  const estimate = {
    distance: estimatedRealDistance,
    duration: estimatedDuration,
    estimated: true
  };

  const apiUrl = 'https://api.openrouteservice.org/v2/directions/' + profile;

  const API_KEY = '5b3ce3597851110001cf6248e7c9fd072c7e4c1fb3d4b984310cc1cd';

  // Seul le résumé (distance/durée) est utilisé : pas de géométrie ni d'instructions
  const body = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat]
    ],
    instructions: false,
    geometry: false
  };

  return fetchJson(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY
    },
    body: JSON.stringify(body)
  })
  .then(data => {
    if (!data.routes || data.routes.length === 0) {
      throw new Error("Aucun itinéraire trouvé");
    }

    const summary = data.routes[0].summary;
    return {
      distance: summary.distance,
      duration: summary.duration,
      estimated: false
    };
  })
  .catch(error => {
    console.warn("Itinéraire OpenRouteService indisponible, utilisation de l'estimation:", error);
    return estimate;
  });
}

export function getTransportAlternatives(origin, destination) {
  if (!origin || !destination ||
      typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
      typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    return Promise.resolve(null);
  }

  const distance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  if (distance < 1500) {
    const walkDuration = Math.round(distance / 1.2);

    return Promise.resolve({
      mode: "🚶‍♂️ Marche",
      duration: walkDuration,
      durationText: formatDuration(walkDuration),
      description: `La marche est une bonne option pour cette distance de ${formatDistance(distance)}.`,
      distance: distance
    });
  }
  else if (distance < 8000) {
    const walkTimeToStation = Math.min(6 * 60, Math.max(3 * 60, Math.round(distance / 8000 * 6 * 60)));
    const walkTimeFromStation = walkTimeToStation;

    const tcDuration = Math.round(distance / (20000 / 3600));
    const waitingTime = 5 * 60;
    const totalDuration = tcDuration + waitingTime + walkTimeToStation + walkTimeFromStation;

    return Promise.resolve({
      mode: "🚇 Transport en commun",
      duration: totalDuration,
      durationText: formatDuration(totalDuration),
      description: `Les transports en commun sont recommandés pour cette distance de ${formatDistance(distance)}.`,
      details: `Dont ~${formatDuration(walkTimeToStation + walkTimeFromStation)} de marche total et ${formatDuration(waitingTime)} d'attente`,
      distance: distance
    });
  }
  else {
    const walkTimeToStation = 7 * 60;
    const walkTimeFromStation = 7 * 60;

    const tcDuration = Math.round(distance / (30000 / 3600));
    const waitingTime = 8 * 60;
    const totalDuration = tcDuration + waitingTime + walkTimeToStation + walkTimeFromStation;

    return Promise.resolve({
      mode: "🚇 Transport en commun rapide",
      duration: totalDuration,
      durationText: formatDuration(totalDuration),
      description: `Pour cette distance de ${formatDistance(distance)}, privilégiez les transports en commun rapides.`,
      details: `Dont ~${formatDuration(walkTimeToStation + walkTimeFromStation)} de marche total et ${formatDuration(waitingTime)} d'attente`,
      distance: distance
    });
  }
}

export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Suggestions d'adresses pour l'autocomplétion (Paris et petite couronne)
 * @param {string} query
 * @param {AbortSignal} [signal] - permet d'annuler une recherche devenue obsolète
 */
export function searchAddresses(query, signal) {
  if (!query || query.length < 3) {
    return Promise.resolve([]);
  }

  const search = q => geocodeSearch(q, { limit: 10, autocomplete: true, signal })
    .then(results => results.filter(r => PARIS_AREA_POSTCODE.test(r.postcode)));

  // Si rien à Paris (ex: "gare de lyon"), on relance en précisant la ville
  return search(query)
    .then(results => {
      if (results.length > 0 || PARIS_AREA_CITIES.test(query) || query.includes(',')) {
        return results;
      }
      return search(`${query} Paris`);
    })
    .catch(error => {
      if (error.name !== 'AbortError') {
        console.error('Erreur lors de la recherche d\'adresses:', error);
      }
      return [];
    });
}
