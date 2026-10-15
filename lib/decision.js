import { calculateRoute, getNearbyVelibStations, getTransportAlternatives } from './api.js';
import { DOCKING_TIME, MAX_DISTANCE_FOR_VELIB, MIN_DISTANCE_FOR_VELIB } from './config.js';
import { calculateHaversineDistance, isValidPosition } from './geo.js';
import { formatDistance, formatDuration } from './utils.js';

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

    const bikeTime = Math.round(bikeRoute.duration);
    let velibTime = bikeTime +
                    Math.min(departureStation.walkDuration, 300) +
                    Math.min(arrivalStation.walkDuration, 300) +
                    DOCKING_TIME;

    if (bikeRoute.distance < 2000) {
      const shortTripBuffer = Math.min(DOCKING_TIME, 60);
      velibTime = bikeTime +
                  Math.min(departureStation.walkDuration, 300) +
                  Math.min(arrivalStation.walkDuration, 300) +
                  shortTripBuffer;
    }

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
      reason += `Temps estimé: ${formatDuration(velibTime)} `;
      reason += `(vélo: ${formatDuration(bikeTime)}, `;
      reason += `marche: ${formatDuration(departureStation.walkDuration + arrivalStation.walkDuration)}, `;
      reason += `prise/dépose: ${formatDuration(DOCKING_TIME)})`;
    } else {
      reason = `Le Vélib n'est pas recommandé pour ce trajet. `;
      if (alternativeTransport) {
        reason += `${alternativeTransport.mode} est plus rapide (${alternativeTransport.durationText} vs ${formatDuration(velibTime)} en Vélib).`;
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
