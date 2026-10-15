import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHaversineDistance,
  calculateRoute,
  fetchJson,
  getCoordinates,
  getNearbyVelibStations,
  getTransportAlternatives,
  reverseGeocode,
  searchAddresses
} from '../../lib/api.js';
import { addressFeature, jsonResponse, silenceConsole, stubFetch, velibRecord } from '../helpers.js';

const HOTEL_DE_VILLE = { lat: 48.856614, lng: 2.3522219 };
const GARE_DE_LYON = { lat: 48.844162, lng: 2.374677 };

describe('calculateHaversineDistance', () => {
  test('1° de latitude ≈ 111,2 km', () => {
    assert.ok(Math.abs(calculateHaversineDistance(0, 0, 1, 0) - 111195) < 1);
  });

  test('distance nulle pour un même point', () => {
    assert.equal(calculateHaversineDistance(48.85, 2.35, 48.85, 2.35), 0);
  });
});

describe('fetchJson', () => {
  test('lève une erreur sur un statut HTTP en échec', async t => {
    stubFetch(t, [[/example/, () => jsonResponse({}, 503)]]);
    await assert.rejects(fetchJson('https://example.test/'), /503/);
  });

  test('abandonne la requête après le délai', async t => {
    stubFetch(t, [[/example/, (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    })]]);
    await assert.rejects(fetchJson('https://example.test/', {}, 20));
  });
});

describe('getNearbyVelibStations', () => {
  test("interroge l'API Vélib autour du point et convertit les stations", async t => {
    const calls = stubFetch(t, [[/opendata\.paris\.fr/, {
      results: [velibRecord({ code: '4016', name: 'Lobau - Hôtel de Ville', bikes: 51, docks: 7, dist: 87.7, lat: 48.8562, lng: 2.3532 })]
    }]]);

    const stations = await getNearbyVelibStations(HOTEL_DE_VILLE, 1500);

    const params = new URL(calls[0].url).searchParams;
    assert.equal(params.get('where'), "within_distance(coordonnees_geo,geom'POINT(2.3522219 48.856614)',1500m)");
    assert.equal(params.get('order_by'), 'dist');
    assert.deepEqual(stations, [{
      id: '4016',
      name: 'Lobau - Hôtel de Ville',
      bikes: 51,
      docks: 7,
      lat: 48.8562,
      lng: 2.3532,
      distance: 87.7,
      distanceText: '88m',
      walkDuration: 73,
      durationText: '1min'
    }]);
  });

  test('élargit le rayon de recherche loin du centre de Paris', async t => {
    const calls = stubFetch(t, [[/opendata\.paris\.fr/, { results: [] }]]);
    await getNearbyVelibStations({ lat: 48.8474, lng: 2.4388 }, 1500); // Vincennes
    assert.match(new URL(calls[0].url).searchParams.get('where'), /,2000m\)$/);
  });

  test('rejette une position invalide', async () => {
    await assert.rejects(getNearbyVelibStations({ lat: '48.85', lng: 2.35 }), /Position invalide/);
  });
});

describe('getCoordinates', () => {
  test('accepte des coordonnées saisies directement, sans appel réseau', async t => {
    const calls = stubFetch(t, []);
    assert.deepEqual(await getCoordinates(' 48.8566, 2.3522 '), { lat: 48.8566, lng: 2.3522 });
    assert.equal(calls.length, 0);
  });

  test("précise « Paris » quand aucune ville n'est donnée", async t => {
    const calls = stubFetch(t, [[/geocodage\/search/, {
      features: [addressFeature({ label: 'Rue de Lyon 75012 Paris', lat: 48.8498, lng: 2.3708, postcode: '75012' })]
    }]]);
    await getCoordinates('Gare de Lyon');
    assert.equal(new URL(calls[0].url).searchParams.get('q'), 'Gare de Lyon Paris');
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
    await assert.rejects(getCoordinates('zzzz introuvable'), /Adresse introuvable/);
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

    assert.equal(route.estimated, true);
    assert.ok(route.distance > 0 && route.duration > 0);
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
});
