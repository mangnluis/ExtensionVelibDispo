import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce, formatDistance, formatDuration } from '../../lib/utils.js';

// Espace insécable entre le nombre et l'unité : « 16 min » ne se coupe pas en fin de ligne
const NBSP = '\u00a0';

test('formatDistance : mètres sous 1 km, kilomètres à la française au-delà', () => {
  assert.equal(formatDistance(250.4), `250${NBSP}m`);
  assert.equal(formatDistance(1500), `1,5${NBSP}km`);
  assert.equal(formatDistance(999.7), `1,0${NBSP}km`, '999,7 m arrondis ne font pas « 1000 m »');
});

test('formatDuration : arrondi à la minute la plus proche', () => {
  assert.equal(formatDuration(29), `<${NBSP}1${NBSP}min`);
  assert.equal(formatDuration(59), `1${NBSP}min`);
  assert.equal(formatDuration(16 * 60 + 40), `17${NBSP}min`);
});

test('formatDuration : heures et minutes sur deux chiffres', () => {
  assert.equal(formatDuration(65 * 60), `1${NBSP}h${NBSP}05`);
  assert.equal(formatDuration(2 * 3600), `2${NBSP}h`);
});

test("debounce n'appelle la fonction qu'une fois, avec les derniers arguments", t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const debounced = debounce((...args) => calls.push(args), 250);

  debounced('a');
  debounced('b');
  t.mock.timers.tick(249);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [['b']]);
});
