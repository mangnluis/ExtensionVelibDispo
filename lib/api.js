/**
 * Module de gestion des requêtes API
 */

/**
 * Récupère les stations Vélib à proximité d'une position
 * 
 * @param {Object} position - {lat: number, lng: number}
 * @param {number} radius - Rayon de recherche en mètres
 * @returns {Promise<Array>} - Stations trouvées
 */
function getNearbyVelibStations(position, radius = 1500) {
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    return Promise.reject(new Error("Position invalide"));
  }

  console.log(`Recherche de stations près de ${position.lat}, ${position.lng} (rayon: ${radius}m)`);

  const distanceFromParis = calculateHaversineDistance(position.lat, position.lng, 48.856614, 2.3522219);
  if (distanceFromParis > 3000) {
    radius = Math.max(radius, 2000);
    console.log(`Position éloignée du centre de Paris (${formatDistance(distanceFromParis)}), rayon augmenté à ${radius}m`);
  }

  const apiUrl = 'https://opendata.paris.fr/api/records/1.0/search/';
  const params = new URLSearchParams({
    dataset: 'velib-disponibilite-en-temps-reel',
    rows: 30,
    geofilter: `distance(position,${position.lat},${position.lng},${radius})`
  });

  params.append('timestamp', Date.now());
  
  return fetch(`${apiUrl}?${params.toString()}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data.records || data.records.length === 0) {
        return [];
      }
      
      return data.records.map(record => {
        const station = record.fields;
        
        const bikes = station.numbikesavailable || 0;
        const docks = station.numdocksavailable || 0;
        
        let distanceWalk = record.fields.dist || 0;
        if (distanceWalk === 0 && station.coordonnees_geo) {
          distanceWalk = calculateHaversineDistance(
            position.lat, position.lng,
            station.coordonnees_geo[0], station.coordonnees_geo[1]
          );
        }
        
        const walkDuration = Math.round(distanceWalk / 1.2);
        
        return {
          id: station.stationcode,
          name: station.name,
          bikes: bikes,
          docks: docks,
          lat: station.coordonnees_geo[0],
          lng: station.coordonnees_geo[1],
          distance: distanceWalk,
          distanceText: formatDistance(distanceWalk),
          walkDuration: walkDuration,
          durationText: formatDuration(walkDuration)
        };
      });
    })
    .catch(error => {
      console.error("Erreur lors de la récupération des stations:", error);
      return [];
    });
}

function getCoordinates(address) {
  if (address === 'Ma position' || address === 'Position actuelle') {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        position => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        error => {
          console.error('Erreur de géolocalisation:', error);
          reject(new Error('Impossible de déterminer votre position actuelle'));
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  let searchAddress = address;
  const containsCity = /paris|boulogne|neuilly|issy|vanves|levallois|clichy|puteaux|malakoff|montrouge/i.test(address);
  
  if (!containsCity && !address.includes(',')) {
    searchAddress = `${address}, Paris`;
    console.log(`Adresse modifiée pour géocodage: "${searchAddress}"`);
  }

  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: searchAddress,
    format: 'json',
    limit: 1,
    'accept-language': 'fr',
    bounded: 1,
    viewbox: '2.2241,48.7965,2.4699,48.9115'
  });
  
  return fetch(`${apiUrl}?${params}`, {
    headers: {
      'User-Agent': 'VelibAdvisor/1.0'
    }
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data) || data.length === 0) {
        console.log("Adresse non trouvée dans Paris, nouvelle recherche élargie");
        
        const widerParams = new URLSearchParams({
          q: address,
          format: 'json',
          limit: 1,
          'accept-language': 'fr',
          countrycodes: 'fr'
        });
        
        return fetch(`${apiUrl}?${widerParams}`, {
          headers: {
            'User-Agent': 'VelibAdvisor/1.0'
          }
        })
          .then(response => response.json())
          .then(widerData => {
            if (!widerData || !Array.isArray(widerData) || widerData.length === 0) {
              throw new Error(`Adresse introuvable: ${address}`);
            }
            return widerData;
          });
      }
      return data;
    })
    .then(data => {
      console.log("Géocodage réussi pour:", address, "->", data[0].display_name);
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    });
}
  
function reverseGeocode(lat, lng) {
  const apiUrl = 'https://nominatim.openstreetmap.org/reverse';
  const params = new URLSearchParams({
    lat: lat,
    lon: lng,
    format: 'json',
    'accept-language': 'fr'
  });
  
  return fetch(`${apiUrl}?${params}`, {
    headers: {
      'User-Agent': 'VelibAdvisor/1.0'
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      return data.display_name;
    });
}
  
function calculateRoute(origin, destination, profile = 'cycling-regular') {
  if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
    return Promise.reject(new Error("Coordonnées d'origine ou de destination invalides"));
  }

  console.log(`Calcul d'itinéraire de ${origin.lat},${origin.lng} à ${destination.lat},${destination.lng} (mode: ${profile})`);

  const directDistance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );
  
  const estimatedDuration = Math.round(directDistance / 5.56);
  
  const routeFactor = 1.2; 
  const estimatedRealDistance = directDistance * routeFactor;

  const apiUrl = 'https://api.openrouteservice.org/v2/directions/' + profile;
  
  const API_KEY = '5b3ce3597851110001cf6248e7c9fd072c7e4c1fb3d4b984310cc1cd';
  
  const body = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat]
    ],
    instructions: true,
    elevation: true
  };
  
  return fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY
    },
    body: JSON.stringify(body)
  })
  .then(response => {
    if (!response.ok) {
      console.warn(`Impossible d'obtenir l'itinéraire depuis OpenRouteService: ${response.status}. Utilisation de l'estimation.`);
      return Promise.resolve({
        fallback: true,
        routes: [{
          summary: {
            distance: estimatedRealDistance,
            duration: estimatedDuration,
            ascent: 0,
            descent: 0
          },
          geometry: null
        }]
      });
    }
    return response.json();
  })
  .then(data => {
    if (!data.routes || data.routes.length === 0) {
      throw new Error("Aucun itinéraire trouvé");
    }
    
    const route = data.routes[0];
    
    return {
      distance: route.summary.distance,
      duration: route.summary.duration,
      ascent: route.summary.ascent || 0,
      descent: route.summary.descent || 0,
      polyline: route.geometry || '',
      points: route.geometry ? decodePolyline(route.geometry) : [],
      estimated: data.fallback || false
    };
  })
  .catch(error => {
    console.error("Erreur lors du calcul d'itinéraire:", error);
    return {
      distance: estimatedRealDistance,
      duration: estimatedDuration,
      ascent: 0,
      descent: 0,
      polyline: '',
      points: [],
      estimated: true
    };
  });
}
  
function getTransportAlternatives(origin, destination) {
  if (!origin || !destination || 
      typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
      typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    return Promise.resolve(null);
  }
  
  const distance = calculateHaversineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  if (distance < 1500) {
    const walkDuration = Math.round(distance / 1.2);
    
    return Promise.resolve({
      mode: "🚶‍♂️ Marche",
      duration: walkDuration,
      durationText: formatDuration(walkDuration),
      description: `La marche est une bonne option pour cette distance de ${formatDistance(distance)}.`,
      distance: distance
    });
  }
  else if (distance < 8000) {
    const walkTimeToStation = Math.min(6 * 60, Math.max(3 * 60, Math.round(distance / 8000 * 6 * 60)));
    const walkTimeFromStation = walkTimeToStation;
    
    const tcDuration = Math.round(distance / (20000 / 3600));
    const waitingTime = 5 * 60;
    const totalDuration = tcDuration + waitingTime + walkTimeToStation + walkTimeFromStation;
    
    return Promise.resolve({
      mode: "🚇 Transport en commun",
      duration: totalDuration,
      durationText: formatDuration(totalDuration),
      description: `Les transports en commun sont recommandés pour cette distance de ${formatDistance(distance)}.`,
      details: `Dont ~${formatDuration(walkTimeToStation + walkTimeFromStation)} de marche total et ${formatDuration(waitingTime)} d'attente`,
      distance: distance
    });
  } 
  else {
    const walkTimeToStation = 7 * 60;
    const walkTimeFromStation = 7 * 60;
    
    const tcDuration = Math.round(distance / (30000 / 3600));
    const waitingTime = 8 * 60;
    const totalDuration = tcDuration + waitingTime + walkTimeToStation + walkTimeFromStation;
    
    return Promise.resolve({
      mode: "🚇 Transport en commun rapide",
      duration: totalDuration,
      durationText: formatDuration(totalDuration),
      description: `Pour cette distance de ${formatDistance(distance)}, privilégiez les transports en commun rapides.`,
      details: `Dont ~${formatDuration(walkTimeToStation + walkTimeFromStation)} de marche total et ${formatDuration(waitingTime)} d'attente`,
      distance: distance
    });
  }
}
  
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}
  
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters/1000).toFixed(1)}km`;
  }
}
  
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes > 0 ? remainingMinutes : ''}`;
  }
}

function searchAddresses(query) {
  if (!query || query.length < 3) {
    return Promise.resolve([]);
  }
  
  console.log(`Recherche d'adresses pour: "${query}"`);
  
  const parisAreaCities = {
    'paris': /^75/,
    'boulogne': /^92100/,
    'neuilly': /^92200/,
    'levallois': /^92300/,
    'issy': /^92130/,
    'vanves': /^92170/,
    'malakoff': /^92240/,
    'montrouge': /^92120/,
    'gentilly': /^94250/,
    'ivry': /^94200/,
    'charenton': /^94220/,
    'saint-mandé': /^94160/,
    'saint-ouen': /^93400/,
    'clichy': /^92110/,
    'puteaux': /^92800/,
    'montreuil': /^93100/,
    'pantin': /^93500/,
    'aubervilliers': /^93300/
  };
  
  let searchQuery = query;
  const containsCity = new RegExp(Object.keys(parisAreaCities).join('|'), 'i').test(query);
  
  if (!containsCity && !query.includes(',')) {
    searchQuery = `${query}, Paris`;
    console.log(`Requête modifiée: "${searchQuery}"`);
  }
  
  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: searchQuery,
    format: 'json',
    limit: 10,
    'accept-language': 'fr',
    addressdetails: 1,
    countrycodes: 'fr',
    bounded: 1,
    viewbox: '2.2241,48.7965,2.4699,48.9115'
  });
  
  return fetch(`${apiUrl}?${params}`, {
    headers: {
      'User-Agent': 'VelibAdvisor/1.0'
    }
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data)) {
        return [];
      }
      
      console.log(`${data.length} résultats bruts trouvés`);
      
      const filteredResults = data.filter(item => {
        const postcode = item.address?.postcode || '';
        
        if (/^75/.test(postcode)) {
          return true;
        }
        
        if (/^(92|93|94)/.test(postcode)) {
          const city = item.address?.city?.toLowerCase() || '';
          return Object.keys(parisAreaCities).some(knownCity => 
            city.includes(knownCity) || parisAreaCities[knownCity].test(postcode)
          );
        }
        
        return false;
      });
      
      console.log(`${filteredResults.length} résultats filtrés pour Paris et banlieue proche`);
      
      return filteredResults
        .map(item => {
          let displayName;
          
          if (item.address) {
            const parts = [];
            
            if (item.address.house_number && item.address.road) {
              parts.push(`${item.address.house_number} ${item.address.road}`);
            } else if (item.address.road) {
              parts.push(item.address.road);
            } else if (item.address.pedestrian) {
              parts.push(item.address.pedestrian);
            }
            
            if (item.address.city || item.address.town || item.address.village || item.address.suburb) {
              parts.push(item.address.city || item.address.town || item.address.village || item.address.suburb);
            }
            
            if (item.address.postcode) {
              parts.push(item.address.postcode);
            }
            
            displayName = parts.join(', ');
          }
          
          if (!displayName) {
            displayName = item.display_name.split(',').slice(0, 3).join(',');
          }
          
          return {
            display_name: displayName,
            full_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            type: item.type,
            importance: parseFloat(item.importance || 0),
            paris_bonus: /^75/.test(item.address?.postcode || '') ? 1 : 0
          };
        })
        .sort((a, b) => {
          return (b.importance + b.paris_bonus) - (a.importance + a.paris_bonus);
        });
    })
    .catch(error => {
      console.error('Erreur lors de la recherche d\'adresses:', error);
      return [];
    });
}
