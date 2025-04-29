let apiCache = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getStations') {
    getNearbyVelibStations({
      lat: request.lat,
      lng: request.lng
    }, request.radius)
      .then(stations => {
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
    
    return true;
  }
  
  if (request.type === 'calculateRoute') {
    const cacheKey = `route_${request.origin.lat}_${request.origin.lng}_${request.destination.lat}_${request.destination.lng}_${request.profile}`;
    
    if (apiCache[cacheKey] && 
        Date.now() - apiCache[cacheKey].timestamp < 24 * 60 * 60 * 1000) {
      sendResponse({data: apiCache[cacheKey].data});
      return true;
    }
    
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

chrome.alarms.create('cleanCache', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanCache') {
    const now = Date.now();
    
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      settings: {
        minBikes: 1,
        minDocks: 1,
        maxWalkDistance: 500,
        preferElectric: false
      }
    });
  } else if (details.reason === 'update') {
  }
});
