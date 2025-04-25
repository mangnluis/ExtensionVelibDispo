/**
 * Script d'arrière-plan de l'extension
 * Gère les tâches en arrière-plan et optimise les requêtes API
 */

// Cache pour les réponses d'API
let apiCache = {};

// Écouteur de messages provenant du popup ou d'autres scripts de l'extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getStations') {
    // Chercher d'abord dans le cache
    const cacheKey = `stations_${request.lat}_${request.lng}_${request.radius}`;
    
    if (apiCache[cacheKey] && 
        Date.now() - apiCache[cacheKey].timestamp < 2 * 60 * 1000) {
      // Renvoyer les données du cache si elles ont moins de 2 minutes
      sendResponse({data: apiCache[cacheKey].data});
      return true;
    }
    
    // Sinon, faire la requête API
    getNearbyVelibStations({
      lat: request.lat,
      lng: request.lng
    }, request.radius)
      .then(stations => {
        // Mettre en cache le résultat
        apiCache[cacheKey] = {
          data: stations,
          timestamp: Date.now()
        };
        
        sendResponse({data: stations});
      })
      .catch(error => {
        console.error('Erreur lors de la récupération des stations:', error);
        sendResponse({error: error.message});
      });
    
    return true; // Indique que la réponse sera envoyée de façon asynchrone
  }
  
  if (request.type === 'calculateRoute') {
    // Chercher dans le cache
    const cacheKey = `route_${request.origin.lat}_${request.origin.lng}_${request.destination.lat}_${request.destination.lng}_${request.profile}`;
    
    if (apiCache[cacheKey] && 
        Date.now() - apiCache[cacheKey].timestamp < 24 * 60 * 60 * 1000) {
      // Données valables 24h pour les itinéraires
      sendResponse({data: apiCache[cacheKey].data});
      return true;
    }
    
    // Faire la requête d'itinéraire
    calculateRoute(
      request.origin,
      request.destination,
      request.profile
    )
      .then(route => {
        apiCache[cacheKey] = {
          data: route,
          timestamp: Date.now()
        };
        
        sendResponse({data: route});
      })
      .catch(error => {
        console.error('Erreur lors du calcul d\'itinéraire:', error);
        sendResponse({error: error.message});
      });
    
    return true;
  }
});

// Nettoyer le cache périodiquement
chrome.alarms.create('cleanCache', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanCache') {
    const now = Date.now();
    
    // Supprimer les entrées de cache trop anciennes
    Object.keys(apiCache).forEach(key => {
      if (key.startsWith('stations_') && 
          now - apiCache[key].timestamp > 2 * 60 * 1000) {
        delete apiCache[key];
      } else if (key.startsWith('route_') && 
                now - apiCache[key].timestamp > 24 * 60 * 60 * 1000) {
        delete apiCache[key];
      }
    });
  }
});

// Installer l'extension ou gérer les mises à jour
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Première installation
    chrome.storage.local.set({
      settings: {
        minBikes: 1,         // Nombre minimum de vélos pour recommander une station
        minDocks: 1,         // Nombre minimum d'emplacements pour recommander une station
        maxWalkDistance: 500, // Distance maximale de marche en mètres
        preferElectric: false // Préférence pour les vélos électriques
      }
    });
  } else if (details.reason === 'update') {
    // Mise à jour de l'extension
    // Garder les paramètres existants ou mettre à jour si nécessaire
  }
});
