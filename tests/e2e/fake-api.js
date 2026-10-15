/**
 * Fausses API pour les tests de bout en bout : Vélib, géocodeur IGN, OpenRouteService
 */

import { addressFeature, velibRecord } from '../helpers.js';

export const HOTEL_DE_VILLE = { lat: 48.856614, lng: 2.3522219 };
export const GARE_DE_LYON = { lat: 48.844162, lng: 2.374677 };

/** Une station bien fournie au départ (au nord de 48,85°), une autre à l'arrivée */
export function defaultStations(lat) {
  return lat > 48.85
    ? [velibRecord({ code: '4016', name: 'Lobau - Hôtel de Ville', bikes: 12, docks: 7, dist: 88 })]
    : [velibRecord({ code: '12001', name: 'Gare de Lyon - Diderot', bikes: 3, docks: 15, dist: 140 })];
}

/**
 * @param {Object} [options]
 * @param {Function} [options.stations] - (lat, lng) => enregistrements Vélib autour du point
 * @param {Object[]} [options.addresses] - features renvoyées par la recherche d'adresses
 * @param {string} [options.reverseLabel] - adresse renvoyée par le géocodage inverse
 * @param {Object|null} [options.route] - résumé OpenRouteService ; null → erreur 500
 * @param {boolean} [options.velibDown] - l'API Vélib répond 503
 * @returns {Function} gestionnaire de requêtes pour openPopup({ api })
 */
export function fakeApi({
  stations = defaultStations,
  addresses = [],
  reverseLabel = "1 Place de l'Hôtel de Ville 75004 Paris",
  route = { distance: 2462, duration: 537 },
  velibDown = false
} = {}) {
  return ({ url }) => {
    const { hostname, pathname, searchParams } = new URL(url);

    if (hostname === 'opendata.paris.fr') {
      if (velibDown) {
        return { status: 503, body: { error: 'Service Unavailable' } };
      }
      const [, lng, lat] = searchParams.get('where').match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
      return { body: { results: stations(Number(lat), Number(lng)) } };
    }

    if (hostname === 'data.geopf.fr' && pathname.endsWith('/search')) {
      return { body: { type: 'FeatureCollection', features: addresses } };
    }

    if (hostname === 'data.geopf.fr' && pathname.endsWith('/reverse')) {
      const lat = Number(searchParams.get('lat'));
      const lng = Number(searchParams.get('lon'));
      return { body: { type: 'FeatureCollection', features: [addressFeature({ label: reverseLabel, lat, lng })] } };
    }

    if (hostname === 'api.openrouteservice.org') {
      return route ? { body: { routes: [{ summary: route }] } } : { status: 500, body: {} };
    }

    return undefined;
  };
}
