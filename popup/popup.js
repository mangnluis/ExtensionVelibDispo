document.addEventListener('DOMContentLoaded', function() {
    // Éléments de l'interface
    const currentLocationInput = document.getElementById('current-location');
    const destinationInput = document.getElementById('destination');
    const detectLocationBtn = document.getElementById('detect-location');
    const analyzeBtn = document.getElementById('analyze-btn');
    const loadingSection = document.getElementById('loading');
    const resultSection = document.getElementById('result-section');
    const recommendationDiv = document.getElementById('recommendation');
    const stationsList = document.getElementById('stations-list');
    const departureStationsList = document.getElementById('departure-stations-list');
    const arrivalStationsList = document.getElementById('arrival-stations-list');
    const alternativeSection = document.getElementById('alternative-section');
    const alternativeContent = document.getElementById('alternative-content');
    const newSearchBtn = document.getElementById('new-search');
  
    // Détection de la position actuelle
    detectLocationBtn.addEventListener('click', function() {
      loadingSection.classList.remove('hidden');
      
      navigator.geolocation.getCurrentPosition(
        function(position) {
          // Convertir coordonnées en adresse lisible
          reverseGeocode(position.coords.latitude, position.coords.longitude)
            .then(address => {
              currentLocationInput.value = address;
              loadingSection.classList.add('hidden');
            })
            .catch(error => {
              currentLocationInput.value = `${position.coords.latitude}, ${position.coords.longitude}`;
              loadingSection.classList.add('hidden');
              console.error('Erreur de géocodage inverse:', error);
            });
        },
        function(error) {
          loadingSection.classList.add('hidden');
          alert('Impossible de détecter votre position. Veuillez l\'entrer manuellement.');
          console.error('Erreur de géolocalisation:', error);
        }
      );
    });
  
    // Analyse du trajet
    analyzeBtn.addEventListener('click', function() {
      // Vérifier si les champs sont remplis
      if (!destinationInput.value) {
        alert('Veuillez entrer une destination');
        return;
      }
  
      loadingSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
      
      // Récupérer les coordonnées depuis les adresses
      Promise.all([
        getCoordinates(currentLocationInput.value || 'Ma position'),
        getCoordinates(destinationInput.value)
      ])
        .then(([originCoords, destCoords]) => {
          // Si utilisation de la localisation actuelle
          if (!currentLocationInput.value) {
            return new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                position => resolve([
                  {lat: position.coords.latitude, lng: position.coords.longitude}, 
                  destCoords
                ]),
                error => {
                  alert('Impossible de détecter votre position. Veuillez l\'entrer manuellement.');
                  loadingSection.classList.add('hidden');
                  throw new Error('Erreur de géolocalisation: ' + error.message);
                }
              );
            });
          }
          return [originCoords, destCoords];
        })
        .then(([originCoords, destCoords]) => {
          // Analyser la faisabilité en Vélib
          return analyzeVelibJourney(originCoords, destCoords);
        })
        .then(result => {
          displayResults(result);
          loadingSection.classList.add('hidden');
          resultSection.classList.remove('hidden');
        })
        .catch(error => {
          console.error('Erreur lors de l\'analyse:', error);
          loadingSection.classList.add('hidden');
          alert('Une erreur s\'est produite lors de l\'analyse. Veuillez réessayer.');
        });
    });
  
    // Afficher les résultats
    function displayResults(result) {
      // Affichage de la recommandation principale
      recommendationDiv.innerHTML = `
        <div class="result-${result.recommendation ? 'yes' : 'no'}">
          <p class="decision-text decision-${result.recommendation ? 'yes' : 'no'}">
            ${result.recommendation ? 'OUI' : 'NON'}
          </p>
          <p class="decision-details">${result.reason}</p>
        </div>
      `;
      
      // Si recommandation positive, afficher les stations
      if (result.recommendation) {
        // Afficher les stations de départ
        departureStationsList.innerHTML = '';
        result.departureStations.forEach(station => {
          const availabilityClass = getAvailabilityClass(station.bikes);
          departureStationsList.innerHTML += `
            <li class="station-item">
              <p class="station-name">${station.name}</p>
              <div class="station-details">
                <span>💪 <span class="${availabilityClass}">${station.bikes} vélos</span></span>
                <span>🚶 ${station.distanceText} (${station.durationText})</span>
              </div>
            </li>
          `;
        });
        
        // Afficher la station d'arrivée
        arrivalStationsList.innerHTML = '';
        result.arrivalStations.forEach(station => {
          const availabilityClass = getAvailabilityClass(station.docks);
          arrivalStationsList.innerHTML += `
            <li class="station-item">
              <p class="station-name">${station.name}</p>
              <div class="station-details">
                <span>🅿️ <span class="${availabilityClass}">${station.docks} places</span></span>
                <span>🚶 ${station.distanceText} (${station.durationText})</span>
              </div>
            </li>
          `;
        });
        
        stationsList.classList.remove('hidden');
        alternativeSection.classList.add('hidden');
      } else {
        // Afficher les alternatives
        alternativeContent.innerHTML = `
          <div class="alternative-card">
            <p class="alternative-mode">${result.alternative.mode}</p>
            <p class="alternative-details">
              ⏱️ ${result.alternative.durationText}<br>
              ${result.alternative.description || ''}
            </p>
          </div>
        `;
        
        alternativeSection.classList.remove('hidden');
        stationsList.classList.add('hidden');
      }
    }
  
    // Utilitaire pour déterminer la classe CSS selon la disponibilité
    function getAvailabilityClass(count) {
      if (count >= 5) return 'good-availability';
      if (count >= 1) return 'low-availability';
      return 'no-availability';
    }
  
    // Reset pour nouvelle recherche
    newSearchBtn.addEventListener('click', function() {
      resultSection.classList.add('hidden');
    });
  });
  