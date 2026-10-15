import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AddressNotFoundError,
  calculateRoute,
  featureToAddress,
  fetchJson,
  getCoordinates,
  getNearbyVelibStations,
  getTransportAlternatives,
  reverseGeocode,
  searchAddresses
} from '../../lib/api.js';
import { BIKE_SPEED, ROUTE_DETOUR_FACTOR } from '../../lib/config.js';
import { calculateHaversineDistance } from '../../lib/geo.js';
import { addressFeature, jsonResponse, poiFeature, silenceConsole, stubFetch, velibRecord } from '../helpers.js';

const HOTEL_DE_VILLE = { lat: 48.856614, lng: 2.3522219 };
const GARE_DE_LYON = { lat: 48.844162, lng: 2.374677 };

describe('fetchJson', () => {
  test('lève une erreur sur un statut HTTP en échec', async t => {
    stubFetch(t, [[/example/, () => jsonResponse({}, 503)]]);
    await assert.rejects(fetchJson('https://example.test/'), /503/);
  });

  test('abandonne la requête après le délai', async t => {
    // Sous Node, le minuteur d'AbortSignal.timeout ne retient pas le processus : on le garde éveillé
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    stubFetch(t, [[/example/, (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    })]]);
    await assert.rejects(fetchJson('https://example.test/', {}, 20), { name: 'TimeoutError' });
  });

  test('respecte un signal déjà annulé', async t => {
    stubFetch(t, [[/example/, { ok: true }]]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchJson('https://example.test/', { signal: controller.signal }), { name: 'AbortError' });
  });
});

describe('getNearbyVelibStations', () => {
  test("interroge l'API Vélib autour du point et convertit les stations", async t => {
    const calls = stubFetch(t, [[/opendata\.paris\.fr/, {
      results: [velibRecord({ code: '4016', name: 'Lobau - Hôtel de Ville', bikes: 51, ebike: 31, docks: 7, dist: 87.7, lat: 48.8562, lng: 2.3532 })]
    }]]);

    const stations = await getNearbyVelibStations(HOTEL_DE_VILLE, 1500);

    const params = new URL(calls[0].url).searchParams;
    assert.equal(params.get('where'), "within_distance(coordonnees_geo,geom'POINT(2.3522219 48.856614)',1500m)");
    assert.equal(params.get('order_by'), 'dist');
    assert.match(params.get('select'), /is_installed,is_renting,is_returning/);
    assert.match(params.get('select'), /mechanical,ebike/);
    assert.deepEqual(stations, [{
      id: '4016',
      name: 'Lobau - Hôtel de Ville',
      bikes: 51,
      mechanical: 20,
      ebike: 31,
      docks: 7,
      renting: true,
      returning: true,
      lat: 48.8562,
      lng: 2.3532,
      distance: 87.7,
      distanceText: '88\u00a0m',
      walkDuration: 73,
      durationText: '1\u00a0min'
    }]);
  });

  test('signale les stations qui ne louent pas ou ne reprennent pas de vélos', async t => {
    stubFetch(t, [[/opendata\.paris\.fr/, {
      results: [
        velibRecord({ code: 'travaux', is_renting: 'NON', is_returning: 'NON' }),
        velibRecord({ code: 'pleine', is_returning: 'NON' }),
        velibRecord({ code: 'demontee', is_installed: 'NON' })
      ]
    }]]);

    const stations = await getNearbyVelibStations(HOTEL_DE_VILLE, 1500);

    assert.deepEqual(
      stations.map(({ id, renting, returning }) => ({ id, renting, returning })),
      [
        { id: 'travaux', renting: false, returning: false },
        { id: 'pleine', renting: true, returning: false },
        { id: 'demontee', renting: false, returning: false }
      ]
    );
  });

  test('élargit le rayon de recherche loin du centre de Paris', async t => {
    const calls = stubFetch(t, [[/opendata\.paris\.fr/, { results: [] }]]);
    await getNearbyVelibStations({ lat: 48.8474, lng: 2.4388 }, 1500); // Vincennes
    assert.match(new URL(calls[0].url).searchParams.get('where'), /,2000m\)$/);
  });

  test('rejette une position invalide', async () => {
    await assert.rejects(getNearbyVelibStations({ lat: '48.85', lng: 2.35 }), /Position invalide/);
  });

  test("signale une panne de l'API au lieu de répondre « aucune station »", async t => {
    stubFetch(t, [[/opendata\.paris\.fr/, () => jsonResponse({}, 503)]]);
    await assert.rejects(getNearbyVelibStations(HOTEL_DE_VILLE, 1500), /Le service Vélib ne répond pas/);
  });
});

describe('getCoordinates', () => {
  test('accepte des coordonnées saisies directement, sans appel réseau', async t => {
    const calls = stubFetch(t, []);
    assert.deepEqual(await getCoordinates(' 48.8566, 2.3522 '), { lat: 48.8566, lng: 2.3522 });
    assert.equal(calls.length, 0);
  });

  test('cherche aussi parmi les lieux (gares, métro, monuments)', async t => {
    const calls = stubFetch(t, [[/geocodage\/search/, {
      features: [poiFeature({ name: 'Gare du Nord', lat: 48.8797, lng: 2.3549, postcode: '75010' })]
    }]]);

    assert.deepEqual(await getCoordinates('Gare du Nord'), { lat: 48.8797, lng: 2.3549 });

    const params = new URL(calls[0].url).searchParams;
    assert.equal(params.get('index'), 'address,poi');
    assert.equal(params.get('q'), 'Gare du Nord', "la requête brute passe d'abord");
  });

  test("précise « Paris » quand rien n'est trouvé en petite couronne", async t => {
    const calls = stubFetch(t, [[/geocodage\/search/, url => {
      const query = new URL(url).searchParams.get('q');
      return {
        features: query.endsWith('Paris')
          ? [poiFeature({ name: 'Gare de Lyon', lat: 48.8457, lng: 2.373, postcode: '75012' })]
          : [addressFeature({ label: 'Gare de Lyon 69003 Lyon', lat: 45.76, lng: 4.86, postcode: '69003' })]
      };
    }]]);

    assert.deepEqual(await getCoordinates('Gare de Lyon'), { lat: 48.8457, lng: 2.373 });
    assert.deepEqual(calls.map(call => new URL(call.url).searchParams.get('q')), ['Gare de Lyon', 'Gare de Lyon Paris']);
  });

  test('préfère le lieu dont le nom est exactement la saisie', async t => {
    stubFetch(t, [[/geocodage\/search/, {
      features: [
        poiFeature({ name: 'Hôtel du Châtelet', lat: 48.8577, lng: 2.3184, postcode: '75007', category: 'quartier' }),
        poiFeature({ name: 'Châtelet', lat: 48.8577, lng: 2.3474, postcode: '75001' })
      ]
    }]]);
    assert.deepEqual(await getCoordinates('chatelet'), { lat: 48.8577, lng: 2.3474 });
  });

  test('privilégie un résultat à Paris ou en petite couronne', async t => {
    stubFetch(t, [[/geocodage\/search/, {
      features: [
        addressFeature({ label: 'Rue de la Paix 69002 Lyon', lat: 45.76, lng: 4.83, postcode: '69002' }),
        addressFeature({ label: 'Rue de la Paix 75002 Paris', lat: 48.8691, lng: 2.3317, postcode: '75002' })
      ]
    }]]);
    assert.deepEqual(await getCoordinates('rue de la paix, paris'), { lat: 48.8691, lng: 2.3317 });
  });

  test('signale une adresse introuvable', async t => {
    stubFetch(t, [[/geocodage\/search/, { features: [] }]]);
    await assert.rejects(getCoordinates('zzzz introuvable'), AddressNotFoundError);
  });

  test("distingue une panne du géocodeur d'une adresse introuvable", async t => {
    stubFetch(t, [[/geocodage\/search/, () => jsonResponse({}, 502)]]);
    const error = await getCoordinates('rue sans reponse').catch(e => e);
    assert.ok(!(error instanceof AddressNotFoundError));
    assert.match(error.message, /recherche d'adresses ne répond pas/);
  });

  test('refuse une adresse hors de Paris et de la petite couronne', async t => {
    stubFetch(t, [[/geocodage\/search/, {
      features: [addressFeature({ label: 'Place du Marché 78000 Versailles', lat: 48.8069, lng: 2.1315, postcode: '78000' })]
    }]]);
    await assert.rejects(getCoordinates('place du marche, versailles'), /Adresse introuvable/);
  });
});

describe('featureToAddress', () => {
  test("reprend le libellé d'une adresse", () => {
    const feature = addressFeature({ label: '10 Rue de Rivoli 75004 Paris', lat: 48.8555, lng: 2.3601, postcode: '75004' });
    assert.deepEqual(featureToAddress(feature), {
      display_name: '10 Rue de Rivoli 75004 Paris',
      name: '10 Rue de Rivoli',
      lat: 48.8555,
      lng: 2.3601,
      postcode: '75004'
    });
  });

  test("compose un libellé pour un lieu, qui n'en a pas", () => {
    const feature = poiFeature({ name: 'Gare de Lyon', lat: 48.8457, lng: 2.373, postcode: '75012', city: ['Paris 12e Arrondissement', 'Paris'] });
    assert.deepEqual(featureToAddress(feature), {
      display_name: 'Gare de Lyon (station de métro) 75012 Paris',
      name: 'Gare de Lyon',
      lat: 48.8457,
      lng: 2.373,
      postcode: '75012'
    });
  });
});

test("reverseGeocode renvoie le libellé de l'adresse", async t => {
  stubFetch(t, [[/geocodage\/reverse/, {
    features: [addressFeature({ label: "1 Place de l'Hôtel de Ville 75004 Paris", lat: 48.8566, lng: 2.3522 })]
  }]]);
  assert.equal(await reverseGeocode(48.8566, 2.3522), "1 Place de l'Hôtel de Ville 75004 Paris");
});

describe('calculateRoute', () => {
  test("utilise la distance et la durée d'OpenRouteService", async t => {
    const calls = stubFetch(t, [[/openrouteservice/, { routes: [{ summary: { distance: 2461.8, duration: 536.9 } }] }]]);

    const route = await calculateRoute(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.deepEqual(route, { distance: 2461.8, duration: 536.9, estimated: false });
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body).coordinates, [[2.3522219, 48.856614], [2.374677, 48.844162]]);
  });

  test('se rabat sur une estimation si le service échoue', async t => {
    silenceConsole(t);
    stubFetch(t, [[/openrouteservice/, () => jsonResponse({}, 500)]]);

    const route = await calculateRoute(HOTEL_DE_VILLE, GARE_DE_LYON);

    const direct = calculateHaversineDistance(HOTEL_DE_VILLE.lat, HOTEL_DE_VILLE.lng, GARE_DE_LYON.lat, GARE_DE_LYON.lng);
    assert.equal(route.estimated, true);
    assert.equal(route.distance, direct * ROUTE_DETOUR_FACTOR);
    assert.equal(route.duration, Math.round(route.distance / BIKE_SPEED), "durée calculée sur la distance allongée, à vitesse de Vélib");
  });

  test('accepte une latitude ou une longitude nulle', async t => {
    stubFetch(t, [[/openrouteservice/, { routes: [{ summary: { distance: 1200, duration: 300 } }] }]]);
    const route = await calculateRoute({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 });
    assert.equal(route.estimated, false);
  });
});

describe('getTransportAlternatives', () => {
  test('la marche sous 1,5 km', async () => {
    const alternative = await getTransportAlternatives(HOTEL_DE_VILLE, { lat: 48.8611, lng: 2.3358 }); // Louvre
    assert.match(alternative.mode, /Marche/);
  });

  test('les transports en commun entre 1,5 et 8 km', async () => {
    const alternative = await getTransportAlternatives(HOTEL_DE_VILLE, GARE_DE_LYON);
    assert.match(alternative.mode, /Transport en commun$/);
  });

  test('les transports rapides au-delà de 8 km', async () => {
    const alternative = await getTransportAlternatives(HOTEL_DE_VILLE, { lat: 48.8918, lng: 2.2362 }); // La Défense
    assert.match(alternative.mode, /rapide/);
  });

  test('aucune alternative pour des coordonnées invalides', async () => {
    assert.equal(await getTransportAlternatives(HOTEL_DE_VILLE, null), null);
  });
});

describe('searchAddresses', () => {
  test('ne cherche rien avant 3 caractères', async t => {
    const calls = stubFetch(t, []);
    assert.deepEqual(await searchAddresses('ru'), []);
    assert.equal(calls.length, 0);
  });

  test('ne garde que Paris et la petite couronne', async t => {
    stubFetch(t, [[/geocodage\/search/, {
      features: [
        addressFeature({ label: '10 Rue de Rivoli 75004 Paris', lat: 48.8555, lng: 2.3601, postcode: '75004' }),
        addressFeature({ label: '10 Rue de Rivoli 59800 Lille', lat: 50.63, lng: 3.07, postcode: '59800' })
      ]
    }]]);
    const results = await searchAddresses('10 rue de rivoli');
    assert.deepEqual(results.map(r => r.display_name), ['10 Rue de Rivoli 75004 Paris']);
  });

  test("relance la recherche avec « Paris » si rien n'est trouvé", async t => {
    const calls = stubFetch(t, [[/geocodage\/search/, url => {
      const query = new URL(url).searchParams.get('q');
      return {
        features: query.endsWith('Paris')
          ? [addressFeature({ label: 'Rue de Lyon 75012 Paris', lat: 48.8498, lng: 2.3708, postcode: '75012' })]
          : []
      };
    }]]);

    const results = await searchAddresses('rue de lyo');

    assert.equal(calls.length, 2);
    assert.equal(results[0].display_name, 'Rue de Lyon 75012 Paris');
  });

  test('propose les lieux, le nom exact en tête', async t => {
    stubFetch(t, [[/geocodage\/search/, {
      features: [
        poiFeature({ name: 'Parking Bastille', lat: 48.852, lng: 2.369, postcode: '75012', category: 'parking' }),
        poiFeature({ name: 'Bastille', lat: 48.8531, lng: 2.3691, postcode: '75004' })
      ]
    }]]);

    const results = await searchAddresses('bastille');

    assert.deepEqual(results.map(r => r.display_name), [
      'Bastille (station de métro) 75004 Paris',
      'Parking Bastille (parking) 75012 Paris'
    ]);
  });
});
