import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce, escapeHtml, formatDistance, formatDuration } from '../../lib/utils.js';

test('formatDistance : mètres sous 1 km, kilomètres au-delà', () => {
  assert.equal(formatDistance(250.4), '250m');
  assert.equal(formatDistance(1500), '1.5km');
});

test('formatDuration : minutes puis heures', () => {
  assert.equal(formatDuration(16 * 60), '16min');
  assert.equal(formatDuration(2 * 3600), '2h');
});

test('escapeHtml neutralise les caractères HTML', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">&`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
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
