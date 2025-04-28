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
    
    // Création des éléments d'autocomplétion
    const currentLocationSuggestions = createAutocompleteContainer(currentLocationInput);
    const destinationSuggestions = createAutocompleteContainer(destinationInput);
    
    // Ajouter des écouteurs pour l'autocomplétion
    setupAutocomplete(currentLocationInput, currentLocationSuggestions);
    setupAutocomplete(destinationInput, destinationSuggestions);

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
                console.error('Erreur de géocodage inverse:', error);
                currentLocationInput.value = 'Position actuelle';
                loadingSection.classList.add('hidden');
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
        getCoordinates(currentLocationInput.value || 'Ma position').catch(err => {
          console.error("Erreur avec l'adresse de départ:", err);
          throw new Error("L'adresse de départ n'a pas pu être localisée. Veuillez la préciser.");
        }),
        getCoordinates(destinationInput.value).catch(err => {
          console.error("Erreur avec l'adresse de destination:", err);
          throw new Error("L'adresse de destination n'a pas pu être localisée. Veuillez la préciser.");
        })
      ])
        .then(([originCoords, destCoords]) => {
          // Vérifier si les coordonnées sont valides
          if (!originCoords || !originCoords.lat || !originCoords.lng) {
            throw new Error("L'adresse de départ n'a pas pu être localisée. Veuillez la préciser.");
          }
          if (!destCoords || !destCoords.lat || !destCoords.lng) {
            throw new Error("L'adresse de destination n'a pas pu être localisée. Veuillez la préciser.");
          }
          
          // Afficher les coordonnées en console pour debug
          console.log("Coordonnées origine:", originCoords);
          console.log("Coordonnées destination:", destCoords);
          
          return [originCoords, destCoords];
        })
        .then(([originCoords, destCoords]) => {
          // Analyser la faisabilité en Vélib
          return analyzeVelibJourney(originCoords, destCoords);
        })
        .then(result => {
          console.log("Résultat de l'analyse:", result);
          
          // Vérifier que le résultat est bien formaté
          if (!result || typeof result.recommendation !== 'boolean') {
            throw new Error("Le résultat de l'analyse est invalide.");
          }
          
          displayResults(result);
          loadingSection.classList.add('hidden');
          resultSection.classList.remove('hidden');
        })
        .catch(error => {
          console.error('Erreur lors de l\'analyse:', error);
          loadingSection.classList.add('hidden');
          
          // Message d'erreur plus précis
          let errorMessage = 'Une erreur s\'est produite lors de l\'analyse.';
          if (error && error.message) {
            errorMessage += ' ' + error.message;
          }
          
          alert(errorMessage);
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
          const stationItem = document.createElement('li');
          stationItem.className = 'station-item';
          stationItem.innerHTML = `
            <p class="station-name">${station.name}</p>
            <div class="station-details">
              <span>${station.distanceText} (${station.durationText})</span>
              <span class="availability ${getAvailabilityClass(station.bikes)}">
                ${station.bikes} vélos disponibles
              </span>
            </div>
          `;
          departureStationsList.appendChild(stationItem);
        });
        
        // Afficher la station d'arrivée
        arrivalStationsList.innerHTML = '';
        result.arrivalStations.forEach(station => {
          const stationItem = document.createElement('li');
          stationItem.className = 'station-item';
          stationItem.innerHTML = `
            <p class="station-name">${station.name}</p>
            <div class="station-details">
              <span>${station.distanceText} (${station.durationText})</span>
              <span class="availability ${getAvailabilityClass(station.docks)}">
                ${station.docks} places disponibles
              </span>
            </div>
          `;
          arrivalStationsList.appendChild(stationItem);
        });
        
        stationsList.classList.remove('hidden');
        alternativeSection.classList.add('hidden');
      } else {
        // Afficher les alternatives
        if (result.alternative) {
          alternativeContent.innerHTML = `
            <div class="alternative-item">
              <p class="alternative-name">${result.alternative.mode}</p>
              <p class="alternative-detail">
                Durée estimée: ${result.alternative.durationText}
              </p>
              <p>${result.alternative.description || ''}</p>
            </div>
          `;
          alternativeSection.classList.remove('hidden');
        } else {
          alternativeSection.classList.add('hidden');
        }
        
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
    
    // Fonctions d'autocomplétion
    function createAutocompleteContainer(inputElement) {
      const container = document.createElement('div');
      container.className = 'autocomplete-suggestions hidden';
      inputElement.parentNode.insertBefore(container, inputElement.nextSibling);
      return container;
    }
    
    function setupAutocomplete(inputElement, suggestionsContainer) {
      // Debounce pour limiter les requêtes pendant la frappe
      const debouncedSearch = debounce(function(searchText) {
        if (searchText.length < 3) {
          suggestionsContainer.classList.add('hidden');
          return;
        }
        
        // Rechercher des suggestions d'adresses
        searchAddresses(searchText)
          .then(suggestions => {
            // Vider et remplir le conteneur de suggestions
            suggestionsContainer.innerHTML = '';
            suggestions.forEach(suggestion => {
              const item = document.createElement('div');
              item.className = 'suggestion-item';
              item.textContent = suggestion.display_name;
              
              item.addEventListener('click', function() {
                inputElement.value = suggestion.display_name;
                suggestionsContainer.classList.add('hidden');
              });
              
              suggestionsContainer.appendChild(item);
            });
            
            if (suggestions.length > 0) {
              suggestionsContainer.classList.remove('hidden');
            } else {
              suggestionsContainer.classList.add('hidden');
            }
          })
          .catch(error => {
            console.error('Erreur lors de la recherche d\'adresses:', error);
          });
      }, 300);
      
      // Écouter la saisie dans le champ
      inputElement.addEventListener('input', function() {
        debouncedSearch(this.value);
      });
      
      // Masquer les suggestions lors du clic ailleurs
      document.addEventListener('click', function(event) {
        if (event.target !== inputElement) {
          suggestionsContainer.classList.add('hidden');
        }
      });
    }
});
