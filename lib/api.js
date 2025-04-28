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
function getNearbyVelibStations(position, radius = 500) {
  // Vérification des paramètres
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    console.error("Position invalide:", position);
    return Promise.reject(new Error("Position invalide"));
  }

  console.log(`Recherche de stations près de ${position.lat}, ${position.lng} (rayon: ${radius}m)`);

  // Pour les longues distances ou positions en banlieue, augmenter automatiquement le rayon
  const distanceFromParis = calculateHaversineDistance(position.lat, position.lng, 48.856614, 2.3522219);
  if (distanceFromParis > 3000) { // Si on est à plus de 3km du centre de Paris
    radius = Math.max(radius, 1000); // Au moins 1000m de rayon
    console.log(`Position éloignée du centre de Paris (${formatDistance(distanceFromParis)}), rayon augmenté à ${radius}m`);
  }

  // URL de l'API Vélib (OpenData Paris)
  const apiUrl = 'https://opendata.paris.fr/api/records/1.0/search/';
  const params = new URLSearchParams({
    dataset: 'velib-disponibilite-en-temps-reel',
    rows: 20, // Augmenté pour avoir plus de résultats
    geofilter: `distance(position,${position.lat},${position.lng},${radius})`
  });

  return fetch(`${apiUrl}?${params.toString()}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Erreur réseau: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      // Vérifier que la réponse a la structure attendue
      if (!data || !data.records) {
        console.error("Réponse API invalide:", data);
        return [];
      }

      console.log(`${data.records.length} stations trouvées dans un rayon de ${radius}m.`);

      // Si aucune station n'est trouvée et que le rayon est encore raisonnable, essayer avec un rayon plus grand
      if (data.records.length === 0 && radius < 2000) {
        console.log(`Aucune station trouvée. Nouvelle recherche avec rayon de ${radius * 2}m`);
        return getNearbyVelibStations(position, radius * 2);
      }

      // Transformer les données des stations
      const stations = data.records
        .filter(record => record.fields && record.fields.coordonnees_geo)
        .map(record => {
          const station = record.fields;
          
          // Calculer la distance de marche
          const stationPosition = {
            lat: station.coordonnees_geo[0],
            lng: station.coordonnees_geo[1]
          };
          
          const distanceWalk = calculateHaversineDistance(
            position.lat, position.lng,
            stationPosition.lat, stationPosition.lng
          );
          
          // Estimation du temps de marche (vitesse moyenne 1.2 m/s)
          const walkDuration = Math.round(distanceWalk / 1.2); // Vitesse moyenne de marche
          
          return {
            id: station.stationcode || record.recordid || `station-${Math.random()}`,
            name: station.name || "Station Vélib",
            lat: stationPosition.lat,
            lng: stationPosition.lng,
            bikes: parseInt(station.numbikesavailable) || 0,
            ebikes: parseInt(station.ebike) || 0,
            docks: parseInt(station.numdocksavailable) || 0,
            distance: distanceWalk,
            distanceText: formatDistance(distanceWalk),
            walkDuration: walkDuration,
            durationText: formatDuration(walkDuration)
          };
        });

      console.log(`${stations.length} stations valides traitées`);
      stations.forEach(s => console.log(`- Station ${s.name}: ${s.bikes} vélos, ${s.docks} places, à ${s.distanceText}`));

      return stations;
    })
    .catch(error => {
      console.error("Erreur lors de la récupération des stations:", error);
      return [];
    });
}

/**
 * Géocode une adresse en coordonnées
 * 
 * @param {string} address - Adresse à convertir
 * @returns {Promise<Object>} - {lat: number, lng: number}
 */
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

  // Ajout automatique de "Paris" si l'adresse ne contient pas de ville
  let searchAddress = address;
  const containsCity = /paris|boulogne|neuilly|issy|vanves|levallois|clichy|puteaux|malakoff|montrouge/i.test(address);
  
  if (!containsCity && !address.includes(',')) {
    searchAddress = `${address}, Paris`;
    console.log(`Adresse modifiée pour géocodage: "${searchAddress}"`);
  }

  // Utilisation de Nominatim (OpenStreetMap)
  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: searchAddress,
    format: 'json',
    limit: 1,
    'accept-language': 'fr',
    bounded: 1,
    viewbox: '2.2241,48.7965,2.4699,48.9115' // Boîte englobant Paris et proche banlieue
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
        // Si rien n'est trouvé, essayer sans les restrictions géographiques
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
  
  /**
   * Inverse géocode des coordonnées en adresse
   * 
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Promise<string>} - Adresse formatée
   */
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
  
  /**
   * Calcule l'itinéraire entre deux points
   */
  function calculateRoute(origin, destination, profile = 'cycling-regular') {
    // Vérification des paramètres
    if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
      console.error("Paramètres d'itinéraire invalides:", {origin, destination});
      return Promise.reject(new Error("Paramètres d'itinéraire invalides"));
    }

    console.log(`Calcul d'itinéraire de ${origin.lat},${origin.lng} à ${destination.lat},${destination.lng} (mode: ${profile})`);

    // Utilisation de OpenRouteService
    const apiUrl = 'https://api.openrouteservice.org/v2/directions/' + profile;
    
    // Vous devrez créer un compte et utiliser votre clé API
    const API_KEY = '5b3ce3597851110001cf6248a2f516d94b8b42f6895a6173cd4a6dcb';
    
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
          throw new Error(`Erreur API OpenRouteService: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log("Réponse OpenRouteService reçue:", data);
        
        // Vérifier que la réponse contient des routes
        if (!data || !data.routes || data.routes.length === 0) {
          console.error("Aucune route trouvée dans la réponse API:", data);
          throw new Error("Aucun itinéraire trouvé entre ces deux points");
        }
        
        const route = data.routes[0];
        
        // Vérifier que la structure attendue est présente
        if (!route.summary) {
          console.error("Format de réponse API inattendu:", route);
          throw new Error("Format de réponse d'itinéraire inattendu");
        }
        
        return {
          distance: route.summary.distance || 0, // en mètres
          duration: route.summary.duration || 0, // en secondes
          distanceText: formatDistance(route.summary.distance || 0),
          durationText: formatDuration(route.summary.duration || 0),
          ascent: route.summary.ascent || 0,
          descent: route.summary.descent || 0,
          geometry: route.geometry || "" // Encodé en polyline
        };
      })
      .catch(error => {
        console.error("Erreur lors du calcul d'itinéraire:", error);
        
        // Solution de secours avec une estimation simple
        const distance = calculateHaversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
        const speedFactor = 1.3; // Facteur pour routes non directes
        
        // Estimation de la durée selon le mode de transport
        let speed;
        switch(profile) {
          case 'cycling-regular':
            speed = 15000 / 3600; // 15 km/h en m/s
            break;
          case 'walking':
            speed = 4000 / 3600; // 4 km/h en m/s
            break;
          default:
            speed = 10000 / 3600; // 10 km/h en m/s
        }
        
        const estimatedDuration = Math.round((distance * speedFactor) / speed);
        
        console.log(`Estimation d'itinéraire utilisée: distance=${distance}m, durée=${estimatedDuration}s`);
        
        // Retourner l'estimation
        return {
          distance: distance,
          duration: estimatedDuration,
          distanceText: formatDistance(distance),
          durationText: formatDuration(estimatedDuration),
          ascent: 0,
          descent: 0,
          geometry: "",
          estimated: true // Indique que c'est une estimation
        };
      });
  }
  
  /**
   * Récupère les alternatives de transport en commun
   * 
   * @param {Object} origin - {lat: number, lng: number}
   * @param {Object} destination - {lat: number, lng: number}
   * @returns {Promise<Object>} - Informations sur les alternatives
   */
  function getTransportAlternatives(origin, destination) {
    // Vérifier les paramètres
    if (!origin || !destination || 
        typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
        typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
      return Promise.resolve(null);
    }

    // Dans un cas réel, on interrogerait une API de transport
    // Ici, on va simuler une réponse pour simplifier
    
    // Calcul de la distance directe
    const distance = calculateHaversineDistance(
      origin.lat, origin.lng,
      destination.lat, destination.lng
    );

    // Si la distance est courte, suggérer la marche
    if (distance < 1500) {  // moins de 1,5 km
      const walkDuration = Math.round(distance / 1.2);  // vitesse moyenne 1.2 m/s
      
      return Promise.resolve({
        mode: "🚶‍♂️ Marche",
        duration: walkDuration,
        durationText: formatDuration(walkDuration),
        description: `La marche est une bonne option pour cette distance de ${formatDistance(distance)}.`,
        distance: distance
      });
    }
    // Pour distances moyennes, transports en commun 
    else if (distance < 8000) {  // moins de 8 km
      // Simule un temps de transport en commun (vitesse moyenne 20 km/h avec attentes)
      const tcDuration = Math.round(distance / (20000 / 3600) + 5 * 60);  // 5 min d'attente
      
      return Promise.resolve({
        mode: "🚇 Transport en commun",
        duration: tcDuration,
        durationText: formatDuration(tcDuration),
        description: `Les transports en commun sont recommandés pour cette distance de ${formatDistance(distance)}.`,
        distance: distance
      });
    } 
    // Pour longues distances
    else {
      const tcDuration = Math.round(distance / (30000 / 3600) + 8 * 60);  // 8 min d'attente
      
      return Promise.resolve({
        mode: "🚇 Transport en commun rapide",
        duration: tcDuration,
        durationText: formatDuration(tcDuration),
        description: `Pour cette distance de ${formatDistance(distance)}, privilégiez les transports en commun rapides.`,
        distance: distance
      });
    }
  }
  
  /**
   * Calcule la distance entre deux points (formule de Haversine)
   */
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Rayon de la Terre en mètres
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
  
  /**
   * Formate une distance en texte lisible
   */
  function formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters/1000).toFixed(1)}km`;
    }
  }
  
  /**
   * Formate une durée en texte lisible
   */
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

  /**
 * Recherche des adresses à partir d'un texte, limitée à Paris et banlieue proche
 * 
 * @param {string} query - Texte de recherche
 * @returns {Promise<Array>} - Liste de suggestions d'adresses
 */
function searchAddresses(query) {
  // Si la requête est vide ou trop courte
  if (!query || query.length < 3) {
    return Promise.resolve([]);
  }
  
  console.log(`Recherche d'adresses pour: "${query}"`);
  
  // Liste des villes de Paris et banlieue proche avec leurs codes postaux
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
  
  // Ajout automatique de "Paris" si le terme ne contient pas de ville
  let searchQuery = query;
  const containsCity = new RegExp(Object.keys(parisAreaCities).join('|'), 'i').test(query);
  
  if (!containsCity && !query.includes(',')) {
    searchQuery = `${query}, Paris`;
    console.log(`Requête modifiée: "${searchQuery}"`);
  }
  
  // Utilisation de Nominatim (OpenStreetMap) pour rechercher des adresses
  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: searchQuery,
    format: 'json',
    limit: 10, // Plus de résultats pour avoir plus de chances de trouver des adresses pertinentes
    'accept-language': 'fr',
    addressdetails: 1,
    countrycodes: 'fr',
    bounded: 1,
    viewbox: '2.2241,48.7965,2.4699,48.9115' // Boîte englobant Paris et proche banlieue
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
      // Formater les résultats
      if (!Array.isArray(data)) {
        return [];
      }
      
      console.log(`${data.length} résultats bruts trouvés`);
      
      // Filtrer pour ne garder que Paris et banlieue proche
      const filteredResults = data.filter(item => {
        // Vérifier le code postal
        const postcode = item.address?.postcode || '';
        
        // Accepter tous les codes postaux de Paris (75xxx)
        if (/^75/.test(postcode)) {
          return true;
        }
        
        // Accepter certains codes postaux de proche banlieue (92, 93, 94)
        if (/^(92|93|94)/.test(postcode)) {
          // Vérifier si c'est une ville de la liste
          const city = item.address?.city?.toLowerCase() || '';
          return Object.keys(parisAreaCities).some(knownCity => 
            city.includes(knownCity) || parisAreaCities[knownCity].test(postcode)
          );
        }
        
        return false;
      });
      
      console.log(`${filteredResults.length} résultats filtrés pour Paris et banlieue proche`);
      
      // Transformer les résultats en format simplifié
      return filteredResults
        .map(item => {
          // Créer un affichage simplifié pour l'adresse
          let displayName;
          
          if (item.address) {
            // Format: "Numéro Rue, Ville, Code Postal"
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
            // Fallback à l'affichage par défaut
            displayName = item.display_name.split(',').slice(0, 3).join(',');
          }
          
          return {
            display_name: displayName,
            full_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            type: item.type,
            importance: parseFloat(item.importance || 0),
            // Ajouter un bonus d'importance pour Paris intra-muros
            paris_bonus: /^75/.test(item.address?.postcode || '') ? 1 : 0
          };
        })
        .sort((a, b) => {
          // Tri par importance avec bonus pour Paris
          return (b.importance + b.paris_bonus) - (a.importance + a.paris_bonus);
        });
    })
    .catch(error => {
      console.error('Erreur lors de la recherche d\'adresses:', error);
      return [];
    });
}
