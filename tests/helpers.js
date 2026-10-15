/**
 * Outils partagés par les tests
 */

/** Coupe les logs du code testé le temps d'un test */
export function silenceConsole(t) {
  for (const method of ['log', 'warn', 'error', 'table']) {
    t.mock.method(console, method, () => {});
  }
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Remplace fetch le temps d'un test.
 * Chaque route associe une RegExp sur l'URL à une réponse : objet JSON, Response,
 * Error (levée) ou fonction (url, options) qui renvoie l'une des trois.
 * @returns {Array<{url: string, options: object}>} requêtes reçues
 */
export function stubFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    // Comme le vrai fetch : un signal déjà annulé fait échouer la requête
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    const route = routes.find(([pattern]) => pattern.test(href));
    if (!route) {
      throw new TypeError(`Requête non simulée : ${href}`);
    }
    let reply = route[1];
    if (typeof reply === 'function') {
      reply = await reply(href, options);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return reply instanceof Response ? reply : jsonResponse(reply);
  });
  return calls;
}

/**
 * Réponse Vélib dépendant du point recherché : stationsFor(lat, lng) renvoie les enregistrements
 */
export function velibByPoint(stationsFor) {
  return url => {
    const where = new URL(url).searchParams.get('where');
    const [, lng, lat] = where.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
    return { results: stationsFor(Number(lat), Number(lng)) };
  };
}

/**
 * Enregistrement au format de l'API Vélib (opendata.paris.fr), station en service par défaut ;
 * sans précision, tous les vélos sont mécaniques
 */
export function velibRecord({ code, name = `Station ${code}`, bikes = 5, ebike = 0, docks = 5, dist = 100, lat = 48.8566, lng = 2.3522, ...rest }) {
  return {
    stationcode: code,
    name,
    numbikesavailable: bikes,
    mechanical: bikes - ebike,
    ebike,
    numdocksavailable: docks,
    is_installed: 'OUI',
    is_renting: 'OUI',
    is_returning: 'OUI',
    coordonnees_geo: { lat, lon: lng },
    dist,
    ...rest
  };
}

/** Feature « adresse » du géocodeur IGN ; name = libellé sans code postal ni ville */
export function addressFeature({ label, lat, lng, postcode = '75001', name = label.replace(/ \d{5} .*$/, '') }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { label, name, postcode, type: 'street', _type: 'address' }
  };
}

/** Feature « POI » du géocodeur IGN : pas de label, name/postcode/city/category en tableaux */
export function poiFeature({ name, lat, lng, postcode = '75001', city = ['Paris 1er Arrondissement', 'Paris'], category = 'station de métro' }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { name: [name], toponym: name, postcode: [postcode], city, category: [category, 'transport'], _type: 'poi' }
  };
}
