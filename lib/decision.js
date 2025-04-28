const CONFIG = {
  MIN_DISTANCE_FOR_VELIB: 500,        // mètres
  MAX_DISTANCE_FOR_VELIB: 10000,      // mètres
  BUFFER_TIME: 300,                   // 5min pour prendre/déposer le vélo
  WALKING_SPEED: 1.2,                 // m/s (4.3 km/h)
  DECISION_THRESHOLD: 1.2             // 20% plus rapide pour recommander
};

function withTimeout(promise, timeoutMs = 10000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Délai d'attente dépassé")), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId));
}

// Exemple d'utilisation:
// return withTimeout(getNearbyVelibStations(origin), 5000);

/*
// Remplacer les appels séquentiels à getNearbyVelibStations par:

// Au lieu d'appels successifs
return getNearbyVelibStations(origin)
  .then(departureStations => {
    // ...
    return getNearbyVelibStations(destination)
      .then(arrivalStations => { /* ... */ /*});
  });

// Utiliser cette version parallélisée:
return Promise.all([
  withTimeout(getNearbyVelibStations(origin), 5000),
  withTimeout(getNearbyVelibStations(destination), 5000)
])
.then(([departureStations, arrivalStations]) => {
  // Traiter les deux résultats ensemble...
  // Reste de la logique
});
*/

// Dans la partie "7. Prendre une décision"
function shouldRecommendVelib(bikeTime, alternativeTime, departureAvailability, arrivalAvailability) {
  // Si vélo clairement plus rapide
  if (bikeTime < alternativeTime * 0.8) return true;
  
  // Si vélo clairement plus lent
  if (bikeTime > alternativeTime * 1.2) return false;
  
  // Cas intermédiaire: considérer la disponibilité
  const goodAvailability = departureAvailability > 3 && arrivalAvailability > 3;
  return goodAvailability ? bikeTime <= alternativeTime * 1.1 : bikeTime < alternativeTime;
}

// Fonction améliorée pour trier les stations
function getBestStations(stations, propertyToCheck, count = 3) {
  if (!stations || !Array.isArray(stations) || stations.length === 0) return [];
  
  return stations
    .filter(s => safeGet(s, propertyToCheck, 0) > 0)
    .sort((a, b) => {
      // Score combinant temps de marche et disponibilité
      const aScore = a.walkDuration + (safeGet(a, propertyToCheck, 0) < 3 ? 300 : 0);
      const bScore = b.walkDuration + (safeGet(b, propertyToCheck, 0) < 3 ? 300 : 0);
      return aScore - bScore;
    })
    .slice(0, count);
}

/**
 * Analyse la faisabilité d'un trajet en Vélib entre deux points
 * @param {Object} origin - Coordonnées du point de départ {lat, lng}
 * @param {Object} destination - Coordonnées de la destination {lat, lng}
 * @return {Promise<Object>} Résultat de l'analyse avec recommandation
 */
function analyzeVelibJourney(origin, destination) {
  // 1. Vérification des données d'entrée
  if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }
  
  console.log("Analyse d'un trajet Vélib de", origin, "à", destination);
  
  // 2. Calcul de la distance à vol d'oiseau
  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );
  
  // 3. Vérifier si la distance est appropriée pour un Vélib
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
        duration: Math.round(directDistance / 5),  // Approximation
        durationText: formatDuration(Math.round(directDistance / 5))
      }
    });
  }
  
  // 4. Rechercher les stations Vélib à proximité (en parallèle)
  return Promise.all([
    withTimeout(getNearbyVelibStations(origin, 750), 5000),
    withTimeout(getNearbyVelibStations(destination, 750), 5000),
    withTimeout(calculateRoute(origin, destination, 'cycling-regular'), 5000),
    withTimeout(getTransportAlternatives(origin, destination), 5000)
  ])
  .then(([departureStations, arrivalStations, bikeRoute, alternative]) => {
    // Reste de la logique d'analyse...
    
    // ... (code existant)
    
    console.log("Résultats des recherches:", {
      departureStations: departureStations?.length || 0,
      arrivalStations: arrivalStations?.length || 0,
      bikeRoute,
      alternative
    });
    
    // 5. Vérifier si des stations ont été trouvées
    if (!departureStations || departureStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre point de départ.",
        alternative
      };
    }
    
    if (!arrivalStations || arrivalStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune station Vélib disponible près de votre destination.",
        alternative
      };
    }
    
    // 6. Filtrer les stations avec des vélos/places disponibles
    const availableStations = departureStations.filter(s => s.bikes > 0);
    const availableDocks = arrivalStations.filter(s => s.docks > 0);
    
    if (availableStations.length === 0) {
      return {
        recommendation: false,
        reason: "Aucun vélo disponible dans les stations proches de votre point de départ.",
        alternative
      };
    }
    
    if (availableDocks.length === 0) {
      return {
        recommendation: false,
        reason: "Aucune place disponible dans les stations proches de votre destination.",
        alternative
      };
    }
    
    // Trouver les meilleures stations
    const bestDepartureStations = getBestStations(availableStations, 'bikes');
    const bestArrivalStations = getBestStations(availableDocks, 'docks');
    
    const departureStation = bestDepartureStations[0];
    const arrivalStation = bestArrivalStations[0];
    
    // 7. Calculer le temps total en Vélib
    const velibTime = bikeRoute.duration + departureStation.walkDuration + 
                      arrivalStation.walkDuration + CONFIG.BUFFER_TIME;
    
    // 8. Prendre une décision
    const shouldTakeVelib = alternative ? 
      shouldRecommendVelib(
        velibTime, 
        alternative.duration, 
        departureStation.bikes, 
        arrivalStation.docks
      ) : true;
    
    // 9. Préparer la réponse
    let reason;
    if (shouldTakeVelib) {
      reason = `Le Vélib est ${alternative ? 'plus rapide' : 'une bonne option'} pour ce trajet. `;
      reason += `Temps total estimé: ${formatDuration(velibTime)} (trajet: ${bikeRoute.durationText}, `;
      reason += `marche: ${formatDuration(departureStation.walkDuration + arrivalStation.walkDuration)}, `;
      reason += `prise/dépose: ${formatDuration(CONFIG.BUFFER_TIME)})`;
    } else {
      reason = `Le Vélib n'est pas recommandé pour ce trajet. `;
      if (alternative) {
        reason += `${alternative.mode} est plus rapide (${alternative.durationText} vs ${formatDuration(velibTime)} en Vélib).`;
      }
    }
    
    return {
      recommendation: shouldTakeVelib,
      reason,
      departureStations: bestDepartureStations,
      arrivalStations: bestArrivalStations,
      routeDistance: bikeRoute.distance,
      routeDuration: bikeRoute.duration,
      totalDuration: velibTime,
      alternative: shouldTakeVelib ? null : alternative
    };
  })
  .catch(error => {
    console.error("Erreur lors de l'analyse du trajet:", error);
    return {
      recommendation: false,
      reason: `Erreur lors de l'analyse: ${error.message}`,
      error: true
    };
  });
}

// Ajouter cette fonction pour accéder en sécurité aux propriétés des objets
function safeGet(obj, path, defaultValue = undefined) {
  if (!obj) return defaultValue;
  
  if (typeof path === 'string') {
    return path.split('.').reduce((o, p) => (o && o[p] !== undefined) ? o[p] : defaultValue, obj);
  }
  
  return obj[path] !== undefined ? obj[path] : defaultValue;
}
