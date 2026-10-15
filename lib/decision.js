import {
  calculateHaversineDistance,
  calculateRoute,
  getNearbyVelibStations,
  getTransportAlternatives
} from './api.js';
import { formatDistance, formatDuration } from './utils.js';

export const CONFIG = {
  MIN_DISTANCE_FOR_VELIB: 500,
  MAX_DISTANCE_FOR_VELIB: 10000,
  BUFFER_TIME: 120,
  WALKING_SPEED: 1.4,
  DECISION_THRESHOLD: 1.2,
  VELIB_SPEED_FACTOR: 1.0
};

export function shouldRecommendVelib(bikeTime, alternativeTime, departureAvailability, arrivalAvailability) {
  if (bikeTime < alternativeTime * 0.8) return true;
  
  if (bikeTime > alternativeTime * 1.2) return false;
  
  const goodAvailability = departureAvailability > 3 && arrivalAvailability > 3;
  return goodAvailability ? bikeTime <= alternativeTime * 1.1 : bikeTime < alternativeTime;
}

export function getBestStations(stations, propertyToCheck, count = 3) {
  if (!stations || !Array.isArray(stations) || stations.length === 0) return [];
  
  const availableStations = stations
    .filter(s => safeGet(s, propertyToCheck, 0) > 0)
    .filter(s => s.distance <= 1000);
  
  if (availableStations.length === 0) {
    const nearestAvailable = stations
      .filter(s => safeGet(s, propertyToCheck, 0) > 0)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
      
    return nearestAvailable;
  }
  
  return availableStations
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export function analyzeVelibJourney(origin, destination) {
  if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }
  
  console.log("Analyse d'un trajet Vélib de", origin, "à", destination);
  
  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );
  
  if (directDistance < CONFIG.MIN_DISTANCE_FOR_VELIB) {
    return Promise.resolve({
      recommendation: false,
      reason: `La distance est trop courte (${formatDistance(directDistance)}), mieux vaut marcher.`,
      alternative: {
        mode: "🚶‍♂️ Marche",
        duration: Math.round(directDistance / CONFIG.WALKING_SPEED),
        durationText: formatDuration(Math.round(directDistance / CONFIG.WALKING_SPEED))
      }
    });
  }
  
  if (directDistance > CONFIG.MAX_DISTANCE_FOR_VELIB) {
    return Promise.resolve({
      recommendation: false,
      reason: `La distance est trop longue (${formatDistance(directDistance)}) pour un Vélib.`,
      alternative: {
        mode: "🚇 Transport en commun",
        duration: Math.round(directDistance / 5),
        durationText: formatDuration(Math.round(directDistance / 5))
      }
    });
  }
  
  // Chaque requête a son propre délai (fetchJson) ; un itinéraire en échec retombe sur une estimation
  return Promise.all([
    getNearbyVelibStations(origin, 1500),
    getNearbyVelibStations(destination, 1500),
    calculateRoute(origin, destination, 'cycling-regular'),
    getTransportAlternatives(origin, destination)
  ])
  .then(([nearDepartureStations, nearArrivalStations, bikeRoute, alternativeTransport]) => {
    // Une station hors service peut encore annoncer des vélos ou des places (données figées)
    const departureStations = nearDepartureStations.filter(s => s.renting);
    const arrivalStations = nearArrivalStations.filter(s => s.returning);

    console.log("Résultats des recherches:", {
      departureStations: departureStations?.length || 0,
      arrivalStations: arrivalStations?.length || 0,
      bikeRoute,
      alternativeTransport
    });
    
    if (!departureStations || departureStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre point de départ.",
        alternative: alternativeTransport
      };
    }
    
    if (!arrivalStations || arrivalStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre destination.",
        alternative: alternativeTransport
      };
    }
    
    const availableStations = departureStations.filter(s => s.bikes > 0);
    const availableDocks = arrivalStations.filter(s => s.docks > 0);
    
    if (availableStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucun vélo disponible dans les stations proches de votre point de départ.",
        alternative: alternativeTransport
      };
    }
    
    if (availableDocks.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune place disponible dans les stations proches de votre destination.",
        alternative: alternativeTransport
      };
    }
    
    const allDepartureStations = departureStations;
    const allArrivalStations = arrivalStations;
    
    const bestDepartureStations = getBestStations(departureStations, 'bikes');
    const bestArrivalStations = getBestStations(arrivalStations, 'docks');
    
    const departureStation = bestDepartureStations[0];
    const arrivalStation = bestArrivalStations[0];
    
    const rawBikeTime = bikeRoute.duration;
    const correctedBikeTime = Math.round(rawBikeTime * CONFIG.VELIB_SPEED_FACTOR); 
    let velibTime = correctedBikeTime + 
                    Math.min(departureStation.walkDuration, 300) +
                    Math.min(arrivalStation.walkDuration, 300) +
                    CONFIG.BUFFER_TIME;

    if (bikeRoute.distance < 2000) {
      const shortTripBuffer = Math.min(CONFIG.BUFFER_TIME, 60);
      velibTime = correctedBikeTime + 
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
      reason += `(vélo: ${formatDuration(correctedBikeTime)}, `;
      reason += `marche: ${formatDuration(departureStation.walkDuration + arrivalStation.walkDuration)}, `;
      reason += `prise/dépose: ${formatDuration(CONFIG.BUFFER_TIME)})`;
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
      allDepartureStations,
      allArrivalStations,
      routeDistance: bikeRoute.distance,
      routeDuration: bikeRoute.duration,
      totalDuration: velibTime,
      alternative: alternativeTransport
    };
  });
}

function safeGet(obj, path, defaultValue = undefined) {
  if (!obj) return defaultValue;
  
  if (typeof path === 'string') {
    return path.split('.').reduce((o, p) => (o && o[p] !== undefined) ? o[p] : defaultValue, obj);
  }
  
  return obj[path] !== undefined ? obj[path] : defaultValue;
}
