import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVelibJourney, getBestStations, shouldRecommendVelib } from '../../lib/decision.js';
import { silenceConsole, stubFetch, velibByPoint, velibRecord } from '../helpers.js';

const HOTEL_DE_VILLE = { lat: 48.856614, lng: 2.3522219 };
const GARE_DE_LYON = { lat: 48.844162, lng: 2.374677 };

/** API simulées : stations au départ (nord) et à l'arrivée (sud), itinéraire ORS */
function stubJourney(t, { departure, arrival, route = { distance: 2462, duration: 537 } }) {
  silenceConsole(t);
  return stubFetch(t, [
    [/opendata\.paris\.fr/, velibByPoint(lat => (lat > 48.85 ? departure : arrival))],
    [/openrouteservice/, { routes: [{ summary: route }] }]
  ]);
}

describe('shouldRecommendVelib', () => {
  test('oui si le Vélib est nettement plus rapide', () => {
    assert.equal(shouldRecommendVelib(700, 1000, 0, 0), true);
  });

  test('non si le Vélib est nettement plus lent', () => {
    assert.equal(shouldRecommendVelib(1300, 1000, 10, 10), false);
  });

  test('entre les deux, la disponibilité tranche', () => {
    assert.equal(shouldRecommendVelib(1050, 1000, 10, 10), true);
    assert.equal(shouldRecommendVelib(1050, 1000, 1, 10), false);
  });
});

describe('getBestStations', () => {
  const stations = [
    { id: 'loin', distance: 1200, bikes: 9 },
    { id: 'vide', distance: 100, bikes: 0 },
    { id: 'b', distance: 400, bikes: 2 },
    { id: 'a', distance: 200, bikes: 5 }
  ];

  test("garde les stations disponibles à moins d'1 km, les plus proches d'abord", () => {
    assert.deepEqual(getBestStations(stations, 'bikes').map(s => s.id), ['a', 'b']);
  });

  test("se rabat sur la plus proche au-delà d'1 km", () => {
    assert.deepEqual(getBestStations([stations[0], stations[1]], 'bikes').map(s => s.id), ['loin']);
  });

  test('liste vide sans station', () => {
    assert.deepEqual(getBestStations([], 'bikes'), []);
  });
});

describe('analyzeVelibJourney', () => {
  test('rejette des coordonnées invalides', async () => {
    await assert.rejects(analyzeVelibJourney(null, GARE_DE_LYON), /invalides/);
  });

  test('conseille la marche sous 500 m, sans appel réseau', async t => {
    silenceConsole(t);
    const calls = stubFetch(t, []);

    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, { lat: 48.858, lng: 2.355 });

    assert.equal(result.recommendation, false);
    assert.match(result.alternative.mode, /Marche/);
    assert.equal(calls.length, 0);
  });

  test('conseille les transports au-delà de 10 km', async t => {
    silenceConsole(t);
    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, { lat: 48.7262, lng: 2.3652 }); // Orly
    assert.equal(result.recommendation, false);
    assert.match(result.alternative.mode, /Transport/);
  });

  test('recommande le Vélib quand il est plus rapide', async t => {
    stubJourney(t, {
      departure: [velibRecord({ code: 'D1', bikes: 10, docks: 3, dist: 100 })],
      arrival: [velibRecord({ code: 'A1', bikes: 2, docks: 10, dist: 150 })]
    });

    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.equal(result.recommendation, true);
    assert.match(result.alternative.mode, /Transport en commun/, "l'alternative est fournie même quand le Vélib l'emporte");
    assert.equal(result.departureStations[0].id, 'D1');
    assert.equal(result.arrivalStations[0].id, 'A1');
    assert.equal(result.totalDuration, 537 + Math.round(100 / 1.2) + Math.round(150 / 1.2) + 120);
  });

  test('ignore les stations hors service, même si elles annoncent des vélos ou des places', async t => {
    stubJourney(t, {
      departure: [
        velibRecord({ code: 'D-travaux', bikes: 3, dist: 50, is_renting: 'NON' }),
        velibRecord({ code: 'D1', bikes: 10, dist: 300 })
      ],
      arrival: [
        velibRecord({ code: 'A-bloquee', docks: 20, dist: 40, is_returning: 'NON' }),
        velibRecord({ code: 'A1', docks: 10, dist: 250 })
      ]
    });

    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.deepEqual(result.departureStations.map(s => s.id), ['D1']);
    assert.deepEqual(result.arrivalStations.map(s => s.id), ['A1']);
  });

  test('non si toutes les stations du départ sont hors service', async t => {
    stubJourney(t, {
      departure: [velibRecord({ code: 'D-travaux', bikes: 3, is_installed: 'NON' })],
      arrival: [velibRecord({ code: 'A1' })]
    });
    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);
    assert.equal(result.recommendation, false);
    assert.match(result.reason, /Aucune station Vélib disponible près de votre point de départ/);
  });

  test('non sans station près du départ', async t => {
    stubJourney(t, { departure: [], arrival: [velibRecord({ code: 'A1' })] });
    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);
    assert.equal(result.recommendation, false);
    assert.match(result.reason, /Aucune station Vélib disponible près de votre point de départ/);
  });

  test('non sans vélo au départ', async t => {
    stubJourney(t, {
      departure: [velibRecord({ code: 'D1', bikes: 0 })],
      arrival: [velibRecord({ code: 'A1' })]
    });
    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);
    assert.equal(result.recommendation, false);
    assert.match(result.reason, /Aucun vélo disponible/);
  });

  test("non sans place à l'arrivée", async t => {
    stubJourney(t, {
      departure: [velibRecord({ code: 'D1' })],
      arrival: [velibRecord({ code: 'A1', docks: 0 })]
    });
    const result = await analyzeVelibJourney(HOTEL_DE_VILLE, GARE_DE_LYON);
    assert.equal(result.recommendation, false);
    assert.match(result.reason, /Aucune place disponible/);
  });
});
