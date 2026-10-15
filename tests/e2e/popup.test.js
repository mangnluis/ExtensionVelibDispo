import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchBrowser } from './browser.js';
import { fakeApi, GARE_DE_LYON, HOTEL_DE_VILLE } from './fake-api.js';

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
  async function analyze(origin, destination, timeout = 5000) {
    await page.fill('#current-location', asText(origin));
    await page.fill('#destination', asText(destination));
    await page.click('#analyze-btn');
    const deadline = Date.now() + timeout;
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

  test("Vélib plus rapide : OUI, avec les stations et l'alternative", async () => {
    page = await browser.openPopup({ api: fakeApi() });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.deepEqual(page.dialogs, []);
    const recommendation = await page.text('#recommendation');
    assert.match(recommendation, /OUI/);
    assert.match(recommendation, /Temps estimé/);
    assert.match(recommendation, /Alternative.*Transport en commun/);
    assert.match(await page.text('#departure-stations-list'), /Lobau - Hôtel de Ville/);
    assert.match(await page.text('#arrival-stations-list'), /Gare de Lyon - Diderot/);
    assert.equal(await page.isVisible('#alternative-section'), false);
    assert.deepEqual(page.unhandledRequests, []);
    assert.deepEqual(page.errors, []);
    await page.screenshot('trajet-velib');
  });

  test("API Vélib en panne : le dit, au lieu de « aucune station » ou d'un NON", async () => {
    page = await browser.openPopup({ api: fakeApi({ velibDown: true }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.equal(page.dialogs.length, 1);
    assert.match(page.dialogs[0], /Le service Vélib ne répond pas/);
    assert.equal(await page.isVisible('#result-section'), false);
  });

  test("OpenRouteService trop lent : l'analyse aboutit avec l'estimation", async () => {
    page = await browser.openPopup({ api: fakeApi({ routeDelay: 6000 }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON, 9000);

    assert.deepEqual(page.dialogs, []);
    assert.match(await page.text('#recommendation'), /OUI|NON/);
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

  test('le bouton de géolocalisation est visible, dans le champ Départ', async () => {
    page = await browser.openPopup({ api: fakeApi() });

    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const icon = document.querySelector('#detect-location svg');
      return {
        input: rect('#current-location'),
        button: rect('#detect-location'),
        iconWidth: icon?.getBoundingClientRect().width ?? 0,
        coordsButton: Boolean(document.getElementById('show-coords-btn'))
      };
    });

    const { input, button } = layout;
    assert.ok(layout.iconWidth > 0, "l'icône est affichée");
    assert.ok(button.left >= input.left && button.right <= input.right, 'bouton dans la largeur du champ');
    assert.ok(button.top >= input.top && button.bottom <= input.bottom, 'bouton dans la hauteur du champ');
    assert.equal(layout.coordsButton, false, 'plus de bouton « Coordonnées exactes » en doublon');
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
