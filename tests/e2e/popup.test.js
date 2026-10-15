import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchBrowser } from './browser.js';
import { fakeApi, HOTEL_DE_VILLE } from './fake-api.js';

const chromePath = findChrome();
const asText = ({ lat, lng }) => `${lat}, ${lng}`;

describe('popup dans Chrome headless', { skip: !chromePath && 'Chrome introuvable : définir CHROME_PATH' }, () => {
  let browser;
  let page;

  before(async () => {
    browser = await launchBrowser(chromePath);
  });

  afterEach(async () => {
    await page?.close();
    page = null;
  });

  after(async () => {
    await browser?.close();
  });

  /** Lance l'analyse et attend le résultat (ou une alerte) */
  async function analyze(origin, destination) {
    await page.fill('#current-location', asText(origin));
    await page.fill('#destination', asText(destination));
    await page.click('#analyze-btn');
    const deadline = Date.now() + 5000;
    while (!page.dialogs.length && !(await page.isVisible('#result-section'))) {
      if (Date.now() > deadline) {
        throw new Error("Pas de résultat d'analyse");
      }
      await new Promise(done => setTimeout(done, 50));
    }
  }

  test("s'ouvre sans erreur", async () => {
    page = await browser.openPopup({ api: fakeApi() });

    assert.equal(await page.evaluate(() => document.title), 'Vélib Advisor');
    assert.equal(await page.isVisible('#analyze-btn'), true);
    assert.equal(await page.isVisible('#result-section'), false);
    assert.deepEqual(page.errors, []);
    await page.screenshot('accueil');
  });

  test('trajet court : NON, et la marche en alternative', async () => {
    page = await browser.openPopup({ api: fakeApi() });

    await analyze(HOTEL_DE_VILLE, { lat: 48.858, lng: 2.355 });

    assert.deepEqual(page.dialogs, []);
    assert.match(await page.text('#recommendation'), /NON/);
    assert.match(await page.text('#alternative-content'), /Marche/);
    assert.deepEqual(page.requests, [], 'aucun appel réseau sous 500 m');
    assert.deepEqual(page.errors, []);
    await page.screenshot('trajet-court');
  });

  test("géolocalisation : le départ affiche l'adresse détectée", async () => {
    page = await browser.openPopup({ api: fakeApi({ reverseLabel: '12 Rue de Rivoli 75004 Paris' }) });

    await page.click('#detect-location');
    await page.waitFor(() => document.getElementById('current-location').value === '12 Rue de Rivoli 75004 Paris');

    assert.deepEqual(page.unhandledRequests, []);
    assert.deepEqual(page.errors, []);
  });

  test('destination manquante : demande de la saisir', async () => {
    page = await browser.openPopup({ api: fakeApi() });

    await page.click('#analyze-btn');

    assert.deepEqual(page.dialogs, ['Veuillez entrer une destination']);
    assert.deepEqual(page.requests, []);
  });
});
