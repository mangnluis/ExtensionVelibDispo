import { calculateRoute, getNearbyVelibStations, getTransportAlternatives } from './api.js';
import {
  DOCKING_TIME,
  MAX_DISTANCE_FOR_VELIB,
  MIN_DISTANCE_FOR_VELIB,
  SHORT_TRIP_DISTANCE,
  SHORT_TRIP_DOCKING_TIME
} from './config.js';
import { calculateHaversineDistance, isValidPosition } from './geo.js';
import { formatDistance, formatDuration } from './utils.js';

/**
 * Temps Vélib détaillé, en minutes entières : le total affiché est la somme des parties affichées
 * (sans quoi 8,8 + 2,5 + 2 min s'afficheraient « 9 + 3 + 2 = 13 min »)
 */
function describeVelibTime(bikeTime, walkTime, dockingTime) {
  const roundToMinute = seconds => Math.round(seconds / 60) * 60;
  const [bike, walk, docking] = [bikeTime, walkTime, dockingTime].map(roundToMinute);
  return {
    total: formatDuration(bike + walk + docking),
    details: `vélo ${formatDuration(bike)}, marche ${formatDuration(walk)}, prise/dépose ${formatDuration(docking)}`
  };
}

export function shouldRecommendVelib(bikeTime, alternativeTime, departureAvailability, arrivalAvailability) {
  if (bikeTime < alternativeTime * 0.8) return true;

  if (bikeTime > alternativeTime * 1.2) return false;

  const goodAvailability = departureAvailability > 3 && arrivalAvailability > 3;
  return goodAvailability ? bikeTime <= alternativeTime * 1.1 : bikeTime < alternativeTime;
}

/**
 * Stations où `propertyToCheck` (bikes ou docks) est disponible, les plus proches d'abord :
 * celles à moins d'1 km, à défaut les plus proches qui restent
 */
export function getBestStations(stations, propertyToCheck, count = 3) {
  if (!Array.isArray(stations) || stations.length === 0) return [];

  const available = stations
    .filter(s => s[propertyToCheck] > 0)
    .sort((a, b) => a.distance - b.distance);
  const withinWalkingDistance = available.filter(s => s.distance <= 1000);

  return (withinWalkingDistance.length > 0 ? withinWalkingDistance : available).slice(0, count);
}

export function analyzeVelibJourney(origin, destination) {
  if (!isValidPosition(origin) || !isValidPosition(destination)) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }

  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  if (directDistance < MIN_DISTANCE_FOR_VELIB) {
    return getTransportAlternatives(origin, destination).then(alternative => ({
      recommendation: false,
      reason: `La distance est trop courte (${formatDistance(directDistance)}), mieux vaut marcher.`,
      alternative
    }));
  }

  if (directDistance > MAX_DISTANCE_FOR_VELIB) {
    return getTransportAlternatives(origin, destination).then(alternative => ({
      recommendation: false,
      reason: `La distance est trop longue (${formatDistance(directDistance)}) pour un Vélib.`,
      alternative
    }));
  }

  // Chaque requête a son propre délai (fetchJson) ; un itinéraire en échec retombe sur une estimation
  return Promise.all([
    getNearbyVelibStations(origin),
    getNearbyVelibStations(destination),
    calculateRoute(origin, destination, 'cycling-regular'),
    getTransportAlternatives(origin, destination)
  ])
  .then(([nearDepartureStations, nearArrivalStations, bikeRoute, alternativeTransport]) => {
    // Une station hors service peut encore annoncer des vélos ou des places (données figées)
    const departureStations = nearDepartureStations.filter(s => s.renting);
    const arrivalStations = nearArrivalStations.filter(s => s.returning);

    if (departureStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre point de départ.",
        alternative: alternativeTransport
      };
    }

    if (arrivalStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre destination.",
        alternative: alternativeTransport
      };
    }

    const bestDepartureStations = getBestStations(departureStations, 'bikes');
    const bestArrivalStations = getBestStations(arrivalStations, 'docks');

    if (bestDepartureStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucun vélo disponible dans les stations proches de votre point de départ.",
        alternative: alternativeTransport
      };
    }

    if (bestArrivalStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune place disponible dans les stations proches de votre destination.",
        alternative: alternativeTransport
      };
    }

    const departureStation = bestDepartureStations[0];
    const arrivalStation = bestArrivalStations[0];

    if (departureStation.id === arrivalStation.id) {
      return {
        recommendation: false,
        reason: `« ${departureStation.name} » est la station la plus proche au départ comme à l'arrivée : le Vélib n'apporte rien sur ce trajet.`,
        departureStations: bestDepartureStations,
        arrivalStations: bestArrivalStations,
        alternative: alternativeTransport
      };
    }

    const bikeTime = Math.round(bikeRoute.duration);
    const walkTime = departureStation.walkDuration + arrivalStation.walkDuration;
    const dockingTime = bikeRoute.distance < SHORT_TRIP_DISTANCE ? SHORT_TRIP_DOCKING_TIME : DOCKING_TIME;
    const velibTime = bikeTime + walkTime + dockingTime;
    const breakdown = describeVelibTime(bikeTime, walkTime, dockingTime);

    const shouldTakeVelib = alternativeTransport ?
      shouldRecommendVelib(
        velibTime,
        alternativeTransport.duration,
        departureStation.bikes,
        arrivalStation.docks
      ) : true;

    let reason;
    if (shouldTakeVelib) {
      reason = `Le Vélib est ${alternativeTransport ? 'plus rapide' : 'une bonne option'} pour ce trajet. `;
      reason += `Temps estimé : ${breakdown.total} (${breakdown.details})`;
    } else {
      reason = `Le Vélib n'est pas recommandé pour ce trajet. `;
      if (alternativeTransport) {
        reason += `${alternativeTransport.mode} est plus rapide (${alternativeTransport.durationText} contre ${breakdown.total} en Vélib).`;
      }
    }

    return {
      recommendation: shouldTakeVelib,
      reason,
      departureStations: bestDepartureStations,
      arrivalStations: bestArrivalStations,
      allDepartureStations: departureStations,
      allArrivalStations: arrivalStations,
      routeDistance: bikeRoute.distance,
      routeDuration: bikeRoute.duration,
      totalDuration: velibTime,
      alternative: alternativeTransport
    };
  });
}
