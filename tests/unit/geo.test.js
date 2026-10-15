import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentPosition } from '../../lib/geo.js';

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
