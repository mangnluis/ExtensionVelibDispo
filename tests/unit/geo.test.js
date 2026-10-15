import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHaversineDistance, getCurrentPosition, isValidPosition } from '../../lib/geo.js';

describe('calculateHaversineDistance', () => {
  test('1° de latitude ≈ 111,2 km', () => {
    assert.ok(Math.abs(calculateHaversineDistance(0, 0, 1, 0) - 111195) < 1);
  });

  test('distance nulle pour un même point', () => {
    assert.equal(calculateHaversineDistance(48.85, 2.35, 48.85, 2.35), 0);
  });
});

describe('isValidPosition', () => {
  test('accepte toute latitude et longitude numériques, 0 compris', () => {
    assert.equal(isValidPosition({ lat: 48.85, lng: 2.35 }), true);
    assert.equal(isValidPosition({ lat: 0, lng: 0 }), true);
  });

  test('refuse les valeurs absentes, textuelles ou non finies', () => {
    for (const position of [null, undefined, {}, { lat: '48.85', lng: 2.35 }, { lat: NaN, lng: 2.35 }, { lat: 48.85, lng: Infinity }]) {
      assert.equal(isValidPosition(position), false, JSON.stringify(position));
    }
  });
});

function stubNavigator(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  t.after(() => {
    if (original) {
      Object.defineProperty(globalThis, 'navigator', original);
    } else {
      delete globalThis.navigator;
    }
  });
}

test('getCurrentPosition renvoie {lat, lng}', async t => {
  stubNavigator(t, {
    geolocation: { getCurrentPosition: resolve => resolve({ coords: { latitude: 48.85, longitude: 2.35 } }) }
  });
  assert.deepEqual(await getCurrentPosition(), { lat: 48.85, lng: 2.35 });
});

test('getCurrentPosition échoue proprement sans géolocalisation', async t => {
  stubNavigator(t, {});
  await assert.rejects(getCurrentPosition(), /n'est pas prise en charge/);
});

test("getCurrentPosition relaie le refus de l'utilisateur", async t => {
  stubNavigator(t, {
    geolocation: { getCurrentPosition: (resolve, reject) => reject({ message: 'User denied Geolocation' }) }
  });
  await assert.rejects(getCurrentPosition(), /User denied Geolocation/);
});
