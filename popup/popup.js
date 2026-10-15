import {
  AddressNotFoundError,
  getCoordinates,
  reverseGeocode,
  searchAddresses
} from '../lib/api.js';
import { analyzeVelibJourney } from '../lib/decision.js';
import { getCurrentPosition } from '../lib/geo.js';
import { debounce } from '../lib/utils.js';

// Module chargé en fin de page : le DOM est déjà analysé

const tripForm = document.getElementById('trip-form');
const currentLocationInput = document.getElementById('current-location');
const destinationInput = document.getElementById('destination');
const detectLocationBtn = document.getElementById('detect-location');
const analyzeBtn = document.getElementById('analyze-btn');
const errorMessage = document.getElementById('error-message');
const loadingSection = document.getElementById('loading');
const resultSection = document.getElementById('result-section');
const recommendationDiv = document.getElementById('recommendation');
const stationsList = document.getElementById('stations-list');
const departureStationsBlock = document.querySelector('.departure-stations');
const arrivalStationsBlock = document.querySelector('.arrival-stations');
const departureStationsList = document.getElementById('departure-stations-list');
const arrivalStationsList = document.getElementById('arrival-stations-list');
const toggleStationsBtn = document.getElementById('toggle-stations');
const alternativeSection = document.getElementById('alternative-section');
const alternativeContent = document.getElementById('alternative-content');
const newSearchBtn = document.getElementById('new-search');
const swapLocationsBtn = document.getElementById('swap-locations');

/** Nombre de stations listées par côté quand l'utilisateur demande à toutes les voir */
const MAX_LISTED_STATIONS = 10;

/** Clé de chrome.storage.local où le dernier trajet est mémorisé d'une ouverture à l'autre */
const LAST_TRIP_KEY = 'lastTrip';

// Coordonnées déjà connues pour un champ (suggestion choisie, géolocalisation) : évite un géocodage.
// Valeur : { lat, lng, fromGeolocation }
const inputCoords = new WeakMap();

// Numéro de l'analyse en cours : une réponse arrivée après une nouvelle recherche est ignorée
let currentAnalysis = 0;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function showError(message) {
  errorMessage.textContent = message;
  setVisible(errorMessage, true);
}

function clearError() {
  errorMessage.textContent = '';
  setVisible(errorMessage, false);
}

/** Pendant un calcul : indicateur de chargement, boutons désactivés (pas de double analyse) */
function setBusy(busy) {
  setVisible(loadingSection, busy);
  analyzeBtn.disabled = busy;
  detectLocationBtn.disabled = busy;
}

function resolveInputCoords(inputElement) {
  const known = inputCoords.get(inputElement);
  // Champ vide : getCoordinates prend la position actuelle
  return known ? Promise.resolve({ lat: known.lat, lng: known.lng }) : getCoordinates(inputElement.value.trim());
}

function setInputCoords(inputElement, coords) {
  if (coords) {
    inputCoords.set(inputElement, coords);
  } else {
    inputCoords.delete(inputElement);
  }
}

/** Champ tel qu'on le mémorise : une position détectée aura changé d'ici la prochaine ouverture */
function snapshot(inputElement) {
  const known = inputCoords.get(inputElement);
  if (known?.fromGeolocation) {
    return { text: '' };
  }
  return { text: inputElement.value.trim(), coords: known && { lat: known.lat, lng: known.lng } };
}

function rememberTrip() {
  chrome.storage.local.set({
    [LAST_TRIP_KEY]: { origin: snapshot(currentLocationInput), destination: snapshot(destinationInput) }
  });
}

// La popup se ferme dès qu'elle perd le focus : on reprend le dernier trajet, sans écraser une saisie
chrome.storage.local.get(LAST_TRIP_KEY).then(({ [LAST_TRIP_KEY]: trip }) => {
  for (const [inputElement, saved] of [[currentLocationInput, trip?.origin], [destinationInput, trip?.destination]]) {
    if (saved?.text && !inputElement.value) {
      inputElement.value = saved.text;
      setInputCoords(inputElement, saved.coords);
    }
  }
});

// Une adresse introuvable est à préciser ; une panne garde son propre message
function explainNotFound(message) {
  return error => {
    throw error instanceof AddressNotFoundError ? new Error(message) : error;
  };
}

// Détection de la position actuelle
detectLocationBtn.addEventListener('click', () => {
  clearError();
  setBusy(true);

  getCurrentPosition()
    .then(coords => {
      // Les coordonnées sont gardées : pas besoin de re-géocoder l'adresse lors de l'analyse
      const known = { ...coords, fromGeolocation: true };
      currentLocationInput.value = 'Position actuelle';
      inputCoords.set(currentLocationInput, known);

      // Adresse lisible, uniquement pour l'affichage ; à défaut « Position actuelle » suffit
      reverseGeocode(coords.lat, coords.lng)
        .then(address => {
          if (inputCoords.get(currentLocationInput) === known) {
            currentLocationInput.value = address;
          }
        })
        .catch(() => {});
    })
    .catch(() => showError("Impossible de détecter votre position. Saisissez l'adresse de départ."))
    .finally(() => setBusy(false));
});

// Analyse du trajet (bouton ou touche Entrée)
tripForm.addEventListener('submit', event => {
  event.preventDefault();
  clearError();
  if (!destinationInput.value.trim()) {
    showError('Veuillez entrer une destination.');
    destinationInput.focus();
    return;
  }

  rememberTrip();
  const analysisId = ++currentAnalysis;
  setBusy(true);
  setVisible(resultSection, false);

  Promise.all([
    resolveInputCoords(currentLocationInput)
      .catch(explainNotFound("L'adresse de départ n'a pas pu être localisée. Veuillez la préciser.")),
    resolveInputCoords(destinationInput)
      .catch(explainNotFound("L'adresse de destination n'a pas pu être localisée. Veuillez la préciser."))
  ])
    .then(([origin, destination]) => analyzeVelibJourney(origin, destination))
    .then(result => {
      if (analysisId === currentAnalysis) {
        renderResult(result);
        setVisible(resultSection, true);
      }
    })
    .catch(error => {
      if (analysisId === currentAnalysis) {
        showError(error.message);
      }
    })
    .finally(() => setBusy(false));
});

// Nouvelle recherche : on garde le départ (souvent la position actuelle), on repart d'une destination vide
newSearchBtn.addEventListener('click', () => {
  currentAnalysis++;
  setVisible(resultSection, false);
  clearError();
  destinationInput.value = '';
  inputCoords.delete(destinationInput);
  rememberTrip();
  destinationInput.focus();
});

// Trajet retour : départ et destination échangent leur texte et leurs coordonnées
swapLocationsBtn.addEventListener('click', () => {
  const origin = { text: currentLocationInput.value, coords: inputCoords.get(currentLocationInput) };
  const destination = { text: destinationInput.value, coords: inputCoords.get(destinationInput) };
  currentLocationInput.value = destination.text;
  setInputCoords(currentLocationInput, destination.coords);
  destinationInput.value = origin.text;
  setInputCoords(destinationInput, origin.coords);
  clearError();
});

function renderResult(result) {
  renderRecommendation(result);
  renderStations(result, false);
  renderAlternative(result);
}

function renderRecommendation({ recommendation, reason, alternative, routeEstimated }) {
  const card = createElement('div', recommendation ? 'result-yes' : 'result-no');
  card.append(
    createElement('p', `decision-text ${recommendation ? 'decision-yes' : 'decision-no'}`,
      recommendation ? 'OUI, prenez un Vélib' : 'NON, évitez le Vélib'),
    createElement('p', 'decision-details', reason)
  );
  // Quand le Vélib l'emporte, l'alternative n'a pas de section à elle : on la rappelle ici
  if (recommendation && alternative) {
    card.append(createElement('p', 'decision-details', `Alternative : ${alternative.mode} (${alternative.durationText})`));
  }
  if (routeEstimated) {
    card.append(createElement('p', 'decision-note', "Durée à vélo estimée : le calcul d'itinéraire n'a pas répondu."));
  }
  recommendationDiv.replaceChildren(card);
}

/**
 * Stations retenues, ou toutes les stations en service trouvées autour de chaque point
 * (les plus proches d'abord) quand `expanded` est vrai
 */
function renderStations(result, expanded) {
  const nearest = stations => [...(stations || [])]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_LISTED_STATIONS);
  const departure = expanded ? nearest(result.allDepartureStations) : result.departureStations || [];
  const arrival = expanded ? nearest(result.allArrivalStations) : result.arrivalStations || [];

  fillStationList(departureStationsList, departure, 'bikes');
  fillStationList(arrivalStationsList, arrival, 'docks');
  setVisible(departureStationsBlock, departure.length > 0);
  setVisible(arrivalStationsBlock, arrival.length > 0);
  setVisible(stationsList, departure.length > 0 || arrival.length > 0);

  const hiddenStations = nearest(result.allDepartureStations).length > departure.length ||
    nearest(result.allArrivalStations).length > arrival.length;
  setVisible(toggleStationsBtn, expanded || hiddenStations);
  toggleStationsBtn.textContent = expanded ? 'Revenir aux stations conseillées' : 'Voir toutes les stations proches';
  toggleStationsBtn.onclick = () => renderStations(result, !expanded);
}

const AVAILABILITY_TEXT = {
  bikes: count => (count === 0 ? 'Aucun vélo' : `${count} vélo${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''}`),
  docks: count => (count === 0 ? 'Aucune place' : `${count} place${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''}`)
};

function describeBikeTypes({ mechanical, ebike }) {
  const plural = count => (count > 1 ? 's' : '');
  return `${mechanical} mécanique${plural(mechanical)} · ${ebike} électrique${plural(ebike)}`;
}

function getAvailabilityClass(count) {
  if (count >= 5) return 'good-availability';
  if (count >= 1) return 'low-availability';
  return 'no-availability';
}

/** @param {'bikes'|'docks'} key - disponibilité affichée : vélos au départ, places à l'arrivée */
function fillStationList(listElement, stations, key) {
  listElement.replaceChildren(...stations.map(station => {
    const details = createElement('div', 'station-details');
    details.append(
      createElement('span', '', `${station.distanceText} (${station.durationText})`),
      createElement('span', `availability ${getAvailabilityClass(station[key])}`, AVAILABILITY_TEXT[key](station[key]))
    );

    const item = createElement('li', 'station-item');
    item.append(createElement('p', 'station-name', station.name), details);
    // Au départ, le type de vélo compte : l'électrique est plus rapide, mais plus cher
    if (key === 'bikes' && station.bikes > 0 && station.mechanical !== null && station.ebike !== null) {
      item.append(createElement('p', 'bike-types', describeBikeTypes(station)));
    }
    return item;
  }));
}

function renderAlternative({ recommendation, alternative }) {
  const visible = !recommendation && Boolean(alternative);
  setVisible(alternativeSection, visible);
  if (!visible) {
    return;
  }

  const item = createElement('div', 'alternative-item');
  item.append(
    createElement('p', 'alternative-name', alternative.mode),
    createElement('p', 'alternative-detail', `Durée estimée : ${alternative.durationText}`)
  );
  if (alternative.details) {
    item.append(createElement('p', 'alternative-breakdown', alternative.details));
  }
  if (alternative.description) {
    item.append(createElement('p', 'alternative-description', alternative.description));
  }
  alternativeContent.replaceChildren(item);
}

// Autocomplétion des adresses (motif ARIA « combobox » : ↑ ↓ pour parcourir, Entrée pour choisir, Échap pour fermer)
setupAutocomplete(currentLocationInput);
setupAutocomplete(destinationInput);

function setupAutocomplete(inputElement) {
  const listbox = createElement('div', 'autocomplete-suggestions hidden');
  listbox.id = `${inputElement.id}-suggestions`;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Suggestions');
  inputElement.after(listbox);

  inputElement.setAttribute('role', 'combobox');
  inputElement.setAttribute('aria-autocomplete', 'list');
  inputElement.setAttribute('aria-controls', listbox.id);
  inputElement.setAttribute('aria-expanded', 'false');

  let pendingSearch = null;
  let suggestions = [];
  let activeIndex = -1;

  function isOpen() {
    return !listbox.classList.contains('hidden');
  }

  function close() {
    // Une recherche encore en cours rouvrirait la liste : elle n'est plus utile
    pendingSearch?.abort();
    setVisible(listbox, false);
    inputElement.setAttribute('aria-expanded', 'false');
    highlight(-1);
  }

  function highlight(index) {
    activeIndex = index;
    [...listbox.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    const active = listbox.children[index];
    if (active) {
      inputElement.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      inputElement.removeAttribute('aria-activedescendant');
    }
  }

  function select(suggestion) {
    inputElement.value = suggestion.display_name;
    setInputCoords(inputElement, { lat: suggestion.lat, lng: suggestion.lng });
    close();
  }

  function open(results) {
    suggestions = results;
    listbox.replaceChildren(...results.map((suggestion, index) => {
      const option = createElement('div', 'suggestion-item', suggestion.display_name);
      option.id = `${listbox.id}-${index}`;
      option.setAttribute('role', 'option');
      // mousedown plutôt que click : le champ garde le focus, la liste ne se ferme pas avant le choix
      option.addEventListener('mousedown', event => {
        event.preventDefault();
        select(suggestion);
      });
      return option;
    }));
    highlight(-1);
    setVisible(listbox, results.length > 0);
    inputElement.setAttribute('aria-expanded', String(results.length > 0));
  }

  // Debounce pour limiter les requêtes pendant la frappe
  const debouncedSearch = debounce(searchText => {
    // Annuler la recherche précédente : sa réponse n'est plus utile
    pendingSearch?.abort();

    if (searchText.length < 3) {
      close();
      return;
    }

    const controller = new AbortController();
    pendingSearch = controller;

    searchAddresses(searchText, controller.signal).then(results => {
      if (!controller.signal.aborted && document.activeElement === inputElement) {
        open(results);
      }
    });
  }, 250);

  inputElement.addEventListener('input', () => {
    // Le texte a changé : les coordonnées mémorisées ne correspondent plus
    inputCoords.delete(inputElement);
    debouncedSearch(inputElement.value);
  });

  inputElement.addEventListener('keydown', event => {
    if (!isOpen()) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight((activeIndex + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      // Choisir la suggestion, pas lancer l'analyse
      event.preventDefault();
      select(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      // Ferme la liste sans fermer la popup
      event.preventDefault();
      close();
    }
  });

  inputElement.addEventListener('blur', close);
}
