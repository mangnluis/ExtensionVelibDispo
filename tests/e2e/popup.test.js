import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { poiFeature, velibRecord } from '../helpers.js';
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

  async function fillTrip(origin, destination) {
    await page.fill('#current-location', asText(origin));
    await page.fill('#destination', asText(destination));
  }

  /** Attend la fin de l'analyse : résultat ou message d'erreur affiché */
  function waitForOutcome(timeout = 5000) {
    return page.waitFor(() => {
      const visible = id => !document.getElementById(id).classList.contains('hidden');
      return visible('result-section') || visible('error-message');
    }, { timeout });
  }

  async function analyze(origin, destination, timeout) {
    await fillTrip(origin, destination);
    await page.click('#analyze-btn');
    await waitForOutcome(timeout);
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

    const recommendation = await page.text('#recommendation');
    assert.match(recommendation, /OUI/);
    assert.match(recommendation, /Temps estimé/);
    assert.match(recommendation, /Alternative : .*Transport en commun/);
    assert.match(await page.text('#departure-stations-list'), /Lobau - Hôtel de Ville/);
    assert.match(await page.text('#arrival-stations-list'), /Gare de Lyon - Diderot/);
    assert.equal(await page.isVisible('#alternative-section'), false);
    assert.deepEqual(page.dialogs, []);
    assert.deepEqual(page.unhandledRequests, []);
    assert.deepEqual(page.errors, []);
    await page.screenshot('trajet-velib');
  });

  test('détaille vélos mécaniques et électriques au départ', async () => {
    const stations = lat => (lat > 48.85
      ? [velibRecord({ code: 'D1', name: 'Départ mixte', bikes: 12, ebike: 9, dist: 80 })]
      : [velibRecord({ code: 'A1', docks: 15, dist: 90 })]);
    page = await browser.openPopup({ api: fakeApi({ stations }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.match(await page.text('#departure-stations-list'), /3 mécaniques · 9 électriques/);
    assert.doesNotMatch(await page.text('#arrival-stations-list'), /mécanique|électrique/);
  });

  test("itinéraire indisponible : la durée vélo est signalée comme estimée", async () => {
    page = await browser.openPopup({ api: fakeApi({ route: null }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.match(await page.text('#recommendation'), /estimée/);
  });

  test('trajet court : NON, et la marche en alternative, sans doublon', async () => {
    page = await browser.openPopup({ api: fakeApi() });

    await analyze(HOTEL_DE_VILLE, { lat: 48.858, lng: 2.355 });

    assert.match(await page.text('#recommendation'), /NON/);
    assert.doesNotMatch(await page.text('#recommendation'), /Alternative/, "l'alternative a sa propre section");
    assert.match(await page.text('#alternative-content'), /Marche/);
    assert.deepEqual(page.requests, [], 'aucun appel réseau sous 500 m');
    assert.deepEqual(page.dialogs, []);
    assert.deepEqual(page.errors, []);
    await page.screenshot('trajet-court');
  });

  test("API Vélib en panne : le dit dans la popup, au lieu de « aucune station » ou d'un NON", async () => {
    page = await browser.openPopup({ api: fakeApi({ velibDown: true }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    assert.match(await page.text('#error-message'), /Le service Vélib ne répond pas/);
    assert.equal(await page.isVisible('#result-section'), false);
    assert.deepEqual(page.dialogs, []);
    await page.screenshot('erreur-api');
  });

  test("OpenRouteService trop lent : l'analyse aboutit avec l'estimation", async () => {
    page = await browser.openPopup({ api: fakeApi({ routeDelay: 6000 }) });

    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON, 9000);

    assert.equal(await page.isVisible('#error-message'), false);
    assert.match(await page.text('#recommendation'), /OUI|NON/);
  });

  test("bouton désactivé pendant l'analyse : un double clic ne lance qu'une analyse", async () => {
    page = await browser.openPopup({ api: fakeApi({ routeDelay: 500 }) });
    await fillTrip(HOTEL_DE_VILLE, GARE_DE_LYON);

    await page.click('#analyze-btn');
    assert.equal(await page.evaluate(() => document.getElementById('analyze-btn').disabled), true);
    await page.click('#analyze-btn');
    await waitForOutcome();

    assert.equal(page.requests.filter(r => r.url.includes('openrouteservice')).length, 1);
    assert.equal(await page.evaluate(() => document.getElementById('analyze-btn').disabled), false);
  });

  test('« Voir toutes les stations proches » déplie la liste dans la popup', async () => {
    const stations = lat => (lat > 48.85
      ? [
        velibRecord({ code: 'D1', name: 'Départ 1', bikes: 6, dist: 80 }),
        velibRecord({ code: 'D2', name: 'Départ vide', bikes: 0, dist: 120 }),
        velibRecord({ code: 'D3', name: 'Départ 3', bikes: 2, dist: 300 }),
        velibRecord({ code: 'D4', name: 'Départ 4', bikes: 9, dist: 450 }),
        velibRecord({ code: 'D5', name: 'Départ 5', bikes: 1, dist: 700 })
      ]
      : [velibRecord({ code: 'A1', name: 'Arrivée 1', docks: 12, dist: 90 })]);
    page = await browser.openPopup({ api: fakeApi({ stations }) });
    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);
    const departureNames = () => page.evaluate(() =>
      [...document.querySelectorAll('#departure-stations-list .station-name')].map(item => item.textContent));

    assert.deepEqual(await departureNames(), ['Départ 1', 'Départ 3', 'Départ 4']);
    await page.click('#toggle-stations');
    assert.deepEqual(await departureNames(), ['Départ 1', 'Départ vide', 'Départ 3', 'Départ 4', 'Départ 5']);
    assert.match(await page.text('#departure-stations-list'), /Aucun vélo/);
    await page.screenshot('toutes-les-stations');
    await page.click('#toggle-stations');
    assert.equal((await departureNames()).length, 3);
    assert.deepEqual(page.dialogs, []);
  });

  test('« Nouvelle recherche » vide la destination et y place le curseur', async () => {
    page = await browser.openPopup({ api: fakeApi() });
    await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);

    await page.click('#new-search');

    assert.equal(await page.isVisible('#result-section'), false);
    assert.equal(await page.evaluate(() => document.getElementById('destination').value), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'destination');
    assert.equal(await page.evaluate(() => document.getElementById('current-location').value), asText(HOTEL_DE_VILLE));
  });

  for (const scheme of ['light', 'dark']) {
    test(`contrastes WCAG AA (≥ 4,5:1) en thème ${scheme === 'light' ? 'clair' : 'sombre'}`, async () => {
      const stations = lat => (lat > 48.85
        ? [velibRecord({ code: 'D1', bikes: 2, dist: 80 }), velibRecord({ code: 'D2', bikes: 0, dist: 120 })]
        : [velibRecord({ code: 'A1', docks: 15, dist: 90 })]);
      page = await browser.openPopup({ api: fakeApi({ stations }) });
      await page.emulateColorScheme(scheme);
      await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);
      await page.click('#toggle-stations');

      const selectors = [
        '#analyze-btn',
        'label',
        '#current-location',
        '.decision-yes',
        '.decision-details',
        '.station-name',
        '.station-details span',
        '.low-availability',
        '.good-availability',
        '.no-availability',
        '#toggle-stations',
        '#new-search',
        'footer p'
      ];
      for (const selector of selectors) {
        const ratio = await page.contrastRatio(selector);
        assert.ok(ratio >= 4.5, `${selector} : ${ratio.toFixed(2)}:1`);
      }
      await page.screenshot(`theme-${scheme}`);

      await page.click('#new-search');
      await page.click('#analyze-btn');
      const errorRatio = await page.contrastRatio('#error-message');
      assert.ok(errorRatio >= 4.5, `#error-message : ${errorRatio.toFixed(2)}:1`);
    });
  }

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

  test('géolocalisation impossible : message dans la popup', async () => {
    page = await browser.openPopup({ api: fakeApi(), position: null });

    await page.click('#detect-location');
    await page.waitFor(() => !document.getElementById('error-message').classList.contains('hidden'), { timeout: 8000 });

    assert.match(await page.text('#error-message'), /Impossible de détecter votre position/);
    assert.equal(await page.evaluate(() => document.getElementById('detect-location').disabled), false);
    assert.deepEqual(page.dialogs, []);
  });

  test("Entrée dans un champ lance l'analyse", async () => {
    page = await browser.openPopup({ api: fakeApi() });
    await fillTrip(HOTEL_DE_VILLE, GARE_DE_LYON);

    await page.evaluate(() => document.getElementById('destination').focus());
    await page.press('Enter');
    await waitForOutcome();

    assert.match(await page.text('#recommendation'), /OUI/);
  });

  describe('suggestions d\'adresses', () => {
    const addresses = [
      poiFeature({ name: 'Bastille', lat: 48.8531, lng: 2.3691, postcode: '75004' }),
      poiFeature({ name: 'Parking Bastille', lat: 48.852, lng: 2.369, postcode: '75012', category: 'parking' })
    ];
    const isListOpen = () => page.evaluate(() => !document.getElementById('destination-suggestions').classList.contains('hidden'));

    async function typeDestination(text) {
      page = await browser.openPopup({ api: fakeApi({ addresses }) });
      await page.fill('#current-location', asText(HOTEL_DE_VILLE));
      await page.type('#destination', text);
      await page.waitFor(() => !document.getElementById('destination-suggestions').classList.contains('hidden'));
    }

    test('suivent le motif ARIA combobox, sans autoremplissage du navigateur', async () => {
      await typeDestination('bastille');

      const aria = await page.evaluate(() => {
        const input = document.getElementById('destination');
        const listbox = document.getElementById(input.getAttribute('aria-controls'));
        return {
          role: input.getAttribute('role'),
          expanded: input.getAttribute('aria-expanded'),
          autocomplete: input.getAttribute('autocomplete'),
          listboxRole: listbox?.getAttribute('role'),
          optionRoles: [...listbox.children].map(option => option.getAttribute('role'))
        };
      });
      assert.deepEqual(aria, {
        role: 'combobox',
        expanded: 'true',
        autocomplete: 'off',
        listboxRole: 'listbox',
        optionRoles: ['option', 'option']
      });
      await page.screenshot('suggestions');
    });

    test('la liste a exactement la largeur du champ', async () => {
      await typeDestination('bastille');

      const widths = await page.evaluate(() => ({
        input: document.getElementById('destination').getBoundingClientRect().width,
        list: document.getElementById('destination-suggestions').getBoundingClientRect().width
      }));

      assert.equal(widths.list, widths.input);
    });

    test("↓ puis Entrée choisit une suggestion sans lancer l'analyse, qui utilise ensuite ses coordonnées", async () => {
      await typeDestination('bastille');

      await page.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.getElementById('destination').getAttribute('aria-activedescendant')), 'destination-suggestions-0');
      await page.press('Enter');

      assert.equal(await page.evaluate(() => document.getElementById('destination').value), 'Bastille (station de métro) 75004 Paris');
      assert.equal(await isListOpen(), false);
      assert.equal(await page.isVisible('#result-section'), false, "le choix ne lance pas l'analyse");

      await page.press('Enter');
      await waitForOutcome();
      const searchedPoints = page.requests
        .filter(request => request.url.includes('opendata.paris.fr'))
        .map(request => new URL(request.url).searchParams.get('where'));
      assert.ok(searchedPoints.some(where => where.includes('POINT(2.3691 48.8531)')), 'stations cherchées autour du lieu choisi');
    });

    test('Échap ferme la liste sans toucher à la saisie', async () => {
      await typeDestination('bastille');

      await page.press('Escape');

      assert.equal(await isListOpen(), false);
      assert.equal(await page.evaluate(() => document.getElementById('destination').getAttribute('aria-expanded')), 'false');
      assert.equal(await page.evaluate(() => document.getElementById('destination').value), 'bastille');
    });

    test('un clic de souris choisit la suggestion', async () => {
      await typeDestination('bastille');

      await page.mouseClick('#destination-suggestions-1');

      assert.equal(await page.evaluate(() => document.getElementById('destination').value), 'Parking Bastille (parking) 75012 Paris');
      assert.equal(await isListOpen(), false);
    });
  });

  describe('dernier trajet mémorisé', () => {
    const stationQueries = () => page.requests
      .filter(request => request.url.includes('opendata.paris.fr'))
      .map(request => new URL(request.url).searchParams.get('where'));

    test("est restauré à l'ouverture suivante", async () => {
      page = await browser.openPopup({ api: fakeApi() });
      await analyze(HOTEL_DE_VILLE, GARE_DE_LYON);
      const saved = await page.evaluate(() => chrome.storage.local.get('lastTrip'));
      await page.close();

      page = await browser.openPopup({ api: fakeApi(), storage: saved });
      await page.waitFor(() => document.getElementById('destination').value !== '');

      assert.equal(await page.evaluate(() => document.getElementById('current-location').value), asText(HOTEL_DE_VILLE));
      assert.equal(await page.evaluate(() => document.getElementById('destination').value), asText(GARE_DE_LYON));
    });

    test("garde les coordonnées d'une suggestion choisie : pas de nouveau géocodage", async () => {
      const storage = {
        lastTrip: {
          origin: { text: asText(HOTEL_DE_VILLE) },
          destination: { text: 'Bastille (station de métro) 75004 Paris', coords: { lat: 48.8531, lng: 2.3691 } }
        }
      };
      page = await browser.openPopup({ api: fakeApi(), storage });
      await page.waitFor(() => document.getElementById('destination').value !== '');

      await page.click('#analyze-btn');
      await waitForOutcome();

      assert.equal(page.requests.filter(request => request.url.includes('geocodage/search')).length, 0);
      assert.ok(stationQueries().some(where => where.includes('POINT(2.3691 48.8531)')));
    });

    test("ne mémorise pas une position détectée, qui aura changé d'ici la prochaine fois", async () => {
      page = await browser.openPopup({ api: fakeApi() });
      await page.click('#detect-location');
      await page.waitFor(() => document.getElementById('current-location').value.includes('Paris'));
      await page.fill('#destination', asText(GARE_DE_LYON));
      await page.click('#analyze-btn');
      await waitForOutcome();

      const { lastTrip } = await page.evaluate(() => chrome.storage.local.get('lastTrip'));

      assert.equal(lastTrip.origin.text, '');
      assert.equal(lastTrip.destination.text, asText(GARE_DE_LYON));
    });
  });

  test('« Inverser » échange départ et destination, coordonnées comprises', async () => {
    page = await browser.openPopup({ api: fakeApi({ addresses: [poiFeature({ name: 'Bastille', lat: 48.8531, lng: 2.3691, postcode: '75004' })] }) });
    await page.fill('#current-location', asText(GARE_DE_LYON));
    await page.type('#destination', 'bastille');
    await page.waitFor(() => !document.getElementById('destination-suggestions').classList.contains('hidden'));
    await page.press('ArrowDown');
    await page.press('Enter');

    await page.click('#swap-locations');

    assert.equal(await page.evaluate(() => document.getElementById('current-location').value), 'Bastille (station de métro) 75004 Paris');
    assert.equal(await page.evaluate(() => document.getElementById('destination').value), asText(GARE_DE_LYON));
    await page.click('#analyze-btn');
    await waitForOutcome();
    const firstStationQuery = page.requests.find(request => request.url.includes('opendata.paris.fr'));
    assert.match(new URL(firstStationQuery.url).searchParams.get('where'), /POINT\(2\.3691 48\.8531\)/, 'départ = coordonnées de la suggestion');
    await page.screenshot('inversion');
  });

  test('destination manquante : demande de la saisir, dans la popup', async () => {
    page = await browser.openPopup({ api: fakeApi() });

    await page.click('#analyze-btn');

    assert.match(await page.text('#error-message'), /Veuillez entrer une destination/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'destination');
    assert.deepEqual(page.dialogs, []);
    assert.deepEqual(page.requests, []);
  });
});
