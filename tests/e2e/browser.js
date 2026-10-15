/**
 * Pilote Chrome en headless par le protocole DevTools (CDP), sans dépendance.
 *
 * Chrome (version de marque) ignore --load-extension depuis la v137 : l'extension est
 * chargée par la commande CDP Extensions.loadUnpacked, qui n'est disponible qu'avec
 * --remote-debugging-pipe et --enable-unsafe-extension-debugging. Les messages
 * circulent sur les descripteurs 3 (vers Chrome) et 4 (depuis Chrome), séparés par \0.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ARTIFACTS_PATH = join(EXTENSION_PATH, 'tests/e2e/artifacts');

const COMMAND_TIMEOUT = 15000;
const POPUP_WIDTH = 360;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

export function findChrome() {
  return CHROME_CANDIDATES.find(path => path && existsSync(path));
}

class CdpConnection {
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();
  #buffer = Buffer.alloc(0);

  constructor(input, output) {
    this.input = input;
    output.on('data', chunk => this.#receive(chunk));
  }

  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let end;
    while ((end = this.#buffer.indexOf(0)) !== -1) {
      const message = JSON.parse(this.#buffer.subarray(0, end).toString('utf8'));
      this.#buffer = this.#buffer.subarray(end + 1);

      const pending = this.#pending.get(message.id);
      if (pending) {
        this.#pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${pending.method} : ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      } else if (message.method) {
        this.#listeners.forEach(listener => listener(message));
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} : pas de réponse de Chrome`));
      }, COMMAND_TIMEOUT);
      this.#pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.input.write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + '\0');
    });
  }

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * Onglet piloté. Enregistre les erreurs JavaScript, les boîtes de dialogue (acceptées
 * automatiquement) et les requêtes réseau HTTPS, servies par le gestionnaire `api`.
 */
class Page {
  /** Exceptions non interceptées et console.error */
  errors = [];
  /** Messages des alert()/confirm() */
  dialogs = [];
  /** Requêtes HTTPS reçues : { url, method, body } */
  requests = [];
  /** Requêtes HTTPS que le gestionnaire `api` n'a pas servies */
  unhandledRequests = [];

  constructor(connection, targetId, sessionId, api) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.api = api;
    this.unsubscribe = connection.on(message => {
      if (message.sessionId === sessionId) {
        this.#onEvent(message).catch(error => this.errors.push(`Gestion de ${message.method} : ${error.message}`));
      }
    });
  }

  send(method, params) {
    return this.connection.send(method, params, this.sessionId);
  }

  async #onEvent({ method, params }) {
    if (method === 'Runtime.exceptionThrown') {
      const { exception, text } = params.exceptionDetails;
      this.errors.push(exception?.description || text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      this.errors.push(params.args.map(arg => arg.value ?? arg.description).join(' '));
    } else if (method === 'Page.javascriptDialogOpening') {
      this.dialogs.push(params.message);
      await this.send('Page.handleJavaScriptDialog', { accept: true });
    } else if (method === 'Fetch.requestPaused') {
      await this.#serve(params);
    }
  }

  async #serve({ requestId, request }) {
    const entry = { url: request.url, method: request.method, body: request.postData };
    this.requests.push(entry);
    const reply = this.api ? await this.api(entry) : undefined;
    if (!reply) {
      this.unhandledRequests.push(entry.url);
      await this.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return;
    }
    if (reply.error) {
      await this.send('Fetch.failRequest', { requestId, errorReason: reply.error });
      return;
    }
    if (reply.delay) {
      await new Promise(done => setTimeout(done, reply.delay));
    }
    // Après un délai, la page a pu abandonner la requête : Chrome refuse alors la réponse
    const fulfilled = this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: reply.status ?? 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Access-Control-Allow-Origin', value: '*' }
      ],
      body: Buffer.from(JSON.stringify(reply.body ?? {})).toString('base64')
    });
    await (reply.delay ? fulfilled.catch(() => {}) : fulfilled);
  }

  waitForEvent(eventName, timeout = COMMAND_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`${eventName} non reçu`)); }, timeout);
      const off = this.connection.on(message => {
        if (message.sessionId === this.sessionId && message.method === eventName) {
          clearTimeout(timer);
          off();
          resolve(message.params);
        }
      });
    });
  }

  /** Exécute une fonction dans la page ; arguments et résultat sont sérialisés en JSON */
  async evaluate(fn, ...args) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  /** Attend qu'une fonction évaluée dans la page renvoie une valeur vraie */
  async waitFor(fn, { timeout = 5000, args = [] } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await this.evaluate(fn, ...args);
      if (value) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`Condition non remplie après ${timeout} ms : ${fn}`);
      }
      await new Promise(done => setTimeout(done, 50));
    }
  }

  isVisible(selector) {
    return this.evaluate(sel => {
      const element = document.querySelector(sel);
      return Boolean(element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    }, selector);
  }

  text(selector) {
    return this.evaluate(sel => document.querySelector(sel)?.innerText.trim() ?? null, selector);
  }

  click(selector) {
    return this.evaluate(sel => {
      const element = document.querySelector(sel);
      if (!element) {
        throw new Error(`Élément introuvable : ${sel}`);
      }
      element.click();
    }, selector);
  }

  /** Remplace la valeur d'un champ sans déclencher d'événement (pas d'autocomplétion) */
  fill(selector, value) {
    return this.evaluate((sel, val) => {
      document.querySelector(sel).value = val;
    }, selector, value);
  }

  /** Saisie comme au clavier : déclenche les événements input */
  async type(selector, text) {
    await this.evaluate(sel => {
      const element = document.querySelector(sel);
      element.focus();
      element.select();
    }, selector);
    await this.send('Input.insertText', { text });
  }

  async press(key) {
    const keys = {
      Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
      ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 }
    };
    const { text, ...definition } = keys[key];
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, text, ...definition });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...definition });
  }

  /** Capture la popup entière dans tests/e2e/artifacts/<name>.png */
  async screenshot(name) {
    const height = await this.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await this.send('Emulation.setDeviceMetricsOverride', { width: POPUP_WIDTH, height, deviceScaleFactor: 1, mobile: false });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(ARTIFACTS_PATH, { recursive: true });
    const path = join(ARTIFACTS_PATH, `${name}.png`);
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  }

  async close() {
    this.unsubscribe();
    await this.connection.send('Target.closeTarget', { targetId: this.targetId });
  }
}

/**
 * Lance Chrome headless avec l'extension chargée.
 * @returns {Promise<{extensionId: string, openPopup: Function, close: Function}>}
 */
export async function launchBrowser(chromePath = findChrome()) {
  if (!chromePath) {
    throw new Error('Chrome introuvable : définir CHROME_PATH');
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'velib-e2e-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const exited = new Promise(done => child.once('exit', done));
  const connection = new CdpConnection(child.stdio[3], child.stdio[4]);

  const { id: extensionId } = await connection.send('Extensions.loadUnpacked', { path: EXTENSION_PATH });

  return {
    extensionId,

    /**
     * Ouvre la popup dans un onglet.
     * @param {Object} [options]
     * @param {Function} [options.api] - (requête) => réponse simulée { status, body } | { error } | undefined
     * @param {{lat: number, lng: number}|null} [options.position] - position renvoyée par la géolocalisation ;
     *   null : position indisponible
     */
    async openPopup({ api, position = { lat: 48.856614, lng: 2.3522219 } } = {}) {
      const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(connection, targetId, sessionId, api);

      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
      // Sans coordonnées, Chrome simule une position indisponible
      await page.send('Emulation.setGeolocationOverride',
        position ? { latitude: position.lat, longitude: position.lng, accuracy: 20 } : {});
      await page.send('Emulation.setDeviceMetricsOverride', { width: POPUP_WIDTH, height: 600, deviceScaleFactor: 1, mobile: false });

      const loaded = page.waitForEvent('Page.loadEventFired');
      await page.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup/popup.html` });
      await loaded;
      return page;
    },

    async close() {
      await connection.send('Browser.close').catch(() => child.kill());
      await exited;
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}
