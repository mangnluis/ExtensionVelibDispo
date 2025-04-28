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

  // Pour les longues distances, augmenter automatiquement le rayon
  if (radius < 800) {
    // Si nous sommes loin du centre de Paris, augmenter davantage le rayon
    const distanceFromParis = calculateHaversineDistance(position.lat, position.lng, 48.856614, 2.3522219);
    if (distanceFromParis > 5000) {
      radius = Math.min(1500, radius * 2);
      console.log(`Position éloignée du centre de Paris, rayon augmenté à ${radius}m`);
    }
  }

  // URL de l'API Vélib (OpenData Paris)
  const apiUrl = 'https://opendata.paris.fr/api/records/1.0/search/';
  const params = new URLSearchParams({
    dataset: 'velib-disponibilite-en-temps-reel',
    rows: 15, // Augmenter le nombre de résultats
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

      console.log(`${data.records.length} stations trouvées.`);

      // Si aucune station trouvée et rayon inférieur à 2km, essayer avec un rayon plus grand
      if (data.records.length === 0 && radius < 2000) {
        console.log(`Aucune station trouvée, recherche avec un rayon plus grand (${radius * 2}m)`);
        return getNearbyVelibStations(position, radius * 2);
      }

      // Transformer les données des stations
      return data.records.map(record => {
        const station = record.fields;
        
        // S'assurer que les coordonnées sont bien présentes
        if (!station.coordonnees_geo || station.coordonnees_geo.length !== 2) {
          console.warn("Station sans coordonnées:", station);
          return null;
        }
        
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
        const walkDuration = Math.round(distanceWalk / 1.2);
        
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
      })
      .filter(station => station !== null)
      .filter(station => station.distance <= 1500); // Limiter aux stations à moins de 1500m
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

  // Utilisation de Nominatim (OpenStreetMap)
  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: 1,
    'accept-language': 'fr'
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
        throw new Error(`Adresse introuvable: ${address}`);
      }
      
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
   * 
   * @param {Object} origin - {lat: number, lng: number}
   * @param {Object} destination - {lat: number, lng: number}
   * @param {string} profile - Type d'itinéraire (cycling, walking, driving)
   * @returns {Promise<Object>} - Informations sur l'itinéraire
   */
  function calculateRoute(origin, destination, profile = 'cycling-regular') {
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
      .then(response => response.json())
      .then(data => {
        const route = data.routes[0];
        
        return {
          distance: route.summary.distance, // en mètres
          duration: route.summary.duration, // en secondes
          distanceText: formatDistance(route.summary.distance),
          durationText: formatDuration(route.summary.duration),
          ascent: route.summary.ascent,
          descent: route.summary.descent,
          geometry: route.geometry // Encodé en polyline
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
 * Recherche des adresses à partir d'un texte
 * 
 * @param {string} query - Texte de recherche
 * @returns {Promise<Array>} - Liste de suggestions d'adresses
 */
function searchAddresses(query) {
  // Si la requête est vide ou trop courte
  if (!query || query.length < 3) {
    return Promise.resolve([]);
  }
  
  // Utilisation de Nominatim (OpenStreetMap) pour rechercher des adresses
  const apiUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: 5,
    'accept-language': 'fr',
    addressdetails: 1,
    countrycodes: 'fr' // Limiter à la France, peut être modifié selon les besoins
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
      
      return data.map(item => ({
        display_name: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
    })
    .catch(error => {
      console.error('Erreur lors de la recherche d\'adresses:', error);
      return [];
    });
}
