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
    // URL de l'API Vélib (OpenData Paris)
    const apiUrl = 'https://opendata.paris.fr/api/records/1.0/search/';
    
    const params = new URLSearchParams({
      dataset: 'velib-disponibilite-en-temps-reel',
      rows: 10,
      sort: 'dist',
      geofilter: `distance(${position.lat}, ${position.lng}, ${radius})`
    });
    
    return fetch(`${apiUrl}?${params}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Erreur API Vélib: ' + response.status);
        }
        return response.json();
      })
      .then(data => {
        // Transformer les données
        return data.records.map(station => ({
          id: station.fields.stationcode,
          name: station.fields.name,
          lat: station.fields.coordonnees_geo[0],
          lng: station.fields.coordonnees_geo[1],
          bikes: station.fields.numbikesavailable,
          mechanicalBikes: station.fields.mechanical,
          electricBikes: station.fields.ebike,
          docks: station.fields.numdocksavailable,
          distance: station.fields.dist // Distance par rapport au point de recherche
        }));
      });
  }
  
  /**
   * Géocode une adresse en coordonnées
   * 
   * @param {string} address - Adresse à convertir
   * @returns {Promise<Object>} - {lat: number, lng: number}
   */
  function getCoordinates(address) {
    if (address === 'Ma position') {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          position => resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          }),
          reject
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
          throw new Error('Erreur de géocodage: ' + response.status);
        }
        return response.json();
      })
      .then(data => {
        if (data.length === 0) {
          throw new Error('Adresse introuvable');
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
    // Note: Une API complète de transport public serait nécessaire ici
    // Comme cette fonction demanderait des API payantes ou complexes,
    // nous simulons une réponse pour l'exemple
    
    return new Promise(resolve => {
      setTimeout(() => {
        // Distance à vol d'oiseau
        const directDistance = calculateHaversineDistance(
          origin.lat, origin.lng,
          destination.lat, destination.lng
        );
        
        let alternative;
        
        if (directDistance < 1000) {
          alternative = {
            mode: '🚶‍♂️ Marche',
            duration: directDistance / 1.2, // Vitesse moyenne 1.2 m/s
            durationText: formatDuration(directDistance / 1.2),
            description: 'Le trajet est court, la marche est la meilleure option.'
          };
        } else if (directDistance < 3000) {
          alternative = {
            mode: '🚌 Bus',
            duration: 600 + Math.random() * 300, // 10-15min
            durationText: '10-15 min',
            description: 'Prenez un bus de la ligne 30.'
          };
        } else {
          alternative = {
            mode: '🚇 Métro',
            duration: 900 + Math.random() * 600, // 15-25min
            durationText: '15-25 min',
            description: 'Prenez la ligne 4 direction Porte d\'Orléans.'
          };
        }
        
        resolve(alternative);
      }, 500);
    });
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
  