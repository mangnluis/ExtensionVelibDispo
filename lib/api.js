/**
 * Module de gestion des requêtes API
 */

import {
  BIKE_SPEED,
  ORS_API_KEY,
  ROUTE_DETOUR_FACTOR,
  STATION_SEARCH_RADIUS,
  WALKING_SPEED
} from './config.js';
import { calculateHaversineDistance, getCurrentPosition, isValidPosition } from './geo.js';
import { formatDistance, formatDuration } from './utils.js';

const GEOCODE_API = 'https://data.geopf.fr/geocodage';
const VELIB_API = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records';
const PARIS_CENTER = { lat: 48.856614, lng: 2.3522219 };
const PARIS_AREA_POSTCODE = /^(75|92|93|94)/;

const geocodeCache = new Map();

/** Aucune adresse correspondant à la saisie (à distinguer d'une panne du géocodeur) */
export class AddressNotFoundError extends Error {}

/**
 * fetch + JSON avec timeout (et annulation externe optionnelle)
 */
export function fetchJson(url, options = {}, timeoutMs = 5000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  return fetch(url, { ...options, signal })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    });
}

/**
 * Remplace une erreur réseau par un message affichable.
 * Une annulation volontaire (saisie devenue obsolète) est relayée telle quelle.
 */
function unavailable(service) {
  return error => {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`${service} ne répond pas, réessayez dans un instant.`, { cause: error });
  };
}

/**
 * Récupère les stations Vélib à proximité d'une position
 *
 * @param {Object} position - {lat: number, lng: number}
 * @param {number} radius - Rayon de recherche en mètres
 * @returns {Promise<Array>} - Stations trouvées, triées par distance
 */
export function getNearbyVelibStations(position, radius = STATION_SEARCH_RADIUS) {
  if (!isValidPosition(position)) {
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
    .catch(unavailable('Le service Vélib'))
    .then(data => {
      return (data.results || []).map(station => {
        const distanceWalk = station.dist || 0;
        const walkDuration = Math.round(distanceWalk / WALKING_SPEED);
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
    });
}

function firstValue(value) {
  return (Array.isArray(value) ? value[0] : value) || '';
}

/**
 * Convertit une feature GeoJSON de l'API IGN (adresse ou lieu) en objet adresse
 */
export function featureToAddress(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const properties = feature.properties;
  const postcode = firstValue(properties.postcode);
  const name = properties.toponym || firstValue(properties.name);

  // Les lieux (POI) n'ont pas de libellé : « Gare de Lyon (station de métro) 75012 Paris »
  let displayName = properties.label;
  if (!displayName) {
    const cities = [].concat(properties.city || []);
    const city = cities.reduce((shortest, c) => (c.length < shortest.length ? c : shortest), cities[0] || '');
    const category = firstValue(properties.category);
    displayName = [category ? `${name} (${category})` : name, postcode, city].filter(Boolean).join(' ');
  }

  return {
    display_name: displayName,
    name,
    lat: lat,
    lng: lng,
    postcode
  };
}

const PARIS_AREA_CITIES = /paris|boulogne|neuilly|levallois|issy|vanves|malakoff|montrouge|gentilly|ivry|charenton|saint-mand[ée]|saint-ouen|clichy|puteaux|montreuil|pantin|aubervilliers|\b(75|92|93|94)\d{3}\b/i;

/**
 * Recherche d'adresses et de lieux (gares, métro, monuments) via le géocodeur IGN (Géoplateforme)
 */
export function geocodeSearch(query, { limit = 1, autocomplete = false, signal } = {}) {

  const cacheKey = `${query}|${limit}|${autocomplete}`;
  if (geocodeCache.has(cacheKey)) {
    return Promise.resolve(geocodeCache.get(cacheKey));
  }

  const params = new URLSearchParams({
    q: query,
    index: 'address,poi',
    limit: limit,
    lat: PARIS_CENTER.lat,
    lon: PARIS_CENTER.lng,
    autocomplete: autocomplete ? 1 : 0
  });

  return fetchJson(`${GEOCODE_API}/search?${params}`, { signal })
    .catch(unavailable("La recherche d'adresses"))
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

  return searchParisArea(address, { limit: 10 })
    .then(results => {
      if (results.length === 0) {
        throw new AddressNotFoundError(`Adresse introuvable à Paris ou en petite couronne: ${address}`);
      }
      return { lat: results[0].lat, lng: results[0].lng };
    });
}

/** Minuscules, sans accents ni ponctuation : « Châtelet » et « chatelet » se valent */
function normalizeName(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Recherche limitée à Paris et à la petite couronne, résultats dont le nom est exactement
 * la saisie en tête (« Châtelet » : la station avant l'« Hôtel du Châtelet », à égalité de score).
 * La saisie brute passe d'abord : y ajouter « Paris » dégrade la recherche des lieux.
 * Sans résultat et sans ville précisée, on relance avec « Paris » (« Gare de Lyon » ne doit pas mener à Lyon).
 */
function searchParisArea(query, options) {
  const inParisArea = results => results.filter(r => PARIS_AREA_POSTCODE.test(r.postcode));
  const wanted = normalizeName(query);
  const isExactName = result => normalizeName(result.name) === wanted;

  return geocodeSearch(query, options)
    .then(results => {
      const local = inParisArea(results);
      if (local.length > 0 || PARIS_AREA_CITIES.test(query) || query.includes(',')) {
        return local;
      }
      return geocodeSearch(`${query} Paris`, options).then(inParisArea);
    })
    .then(results => [...results].sort((a, b) => isExactName(b) - isExactName(a)));
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
  if (!isValidPosition(origin) || !isValidPosition(destination)) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }

  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  // Repli si OpenRouteService ne répond pas : distance allongée des détours, vitesse moyenne en ville
  const estimatedDistance = directDistance * ROUTE_DETOUR_FACTOR;
  const estimate = {
    distance: estimatedDistance,
    duration: Math.round(estimatedDistance / BIKE_SPEED),
    estimated: true
  };

  const apiUrl = 'https://api.openrouteservice.org/v2/directions/' + profile;

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
      'Authorization': ORS_API_KEY
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
  if (!isValidPosition(origin) || !isValidPosition(destination)) {
    return Promise.resolve(null);
  }

  const distance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  if (distance < 1500) {
    const walkDuration = Math.round(distance / WALKING_SPEED);

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

/**
 * Suggestions d'adresses pour l'autocomplétion (Paris et petite couronne)
 * @param {string} query
 * @param {AbortSignal} [signal] - permet d'annuler une recherche devenue obsolète
 */
export function searchAddresses(query, signal) {
  if (!query || query.length < 3) {
    return Promise.resolve([]);
  }

  return searchParisArea(query, { limit: 10, autocomplete: true, signal })
    .catch(error => {
      if (error.name !== 'AbortError') {
        console.error('Erreur lors de la recherche d\'adresses:', error);
      }
      return [];
    });
}
