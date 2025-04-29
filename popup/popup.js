document.addEventListener('DOMContentLoaded', function() {
    // Éléments de l'interface
    const currentLocationInput = document.getElementById('current-location');
    const destinationInput = document.getElementById('destination');
    const detectLocationBtn = document.getElementById('detect-location');
    // Ajouter cette ligne pour créer le nouveau bouton
    const showCoordsBtn = document.createElement('button');
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

    // Configuration du bouton de coordonnées
    showCoordsBtn.id = 'show-coords-btn';
    showCoordsBtn.innerHTML = '📍 Coordonnées exactes';
    showCoordsBtn.className = 'secondary-btn';
    showCoordsBtn.style.marginTop = '8px';
    
    // Insérer le bouton après le champ de localisation
    currentLocationInput.parentNode.appendChild(showCoordsBtn);
    
    // Écouteur d'événement pour le nouveau bouton
    showCoordsBtn.addEventListener('click', function() {
      loadingSection.classList.remove('hidden');
      
      navigator.geolocation.getCurrentPosition(
        function(position) {
          const lat = position.coords.latitude.toFixed(6);
          const lng = position.coords.longitude.toFixed(6);
          
          // Afficher directement les coordonnées
          currentLocationInput.value = `${lat}, ${lng}`;
          loadingSection.classList.add('hidden');
          
          // Optionnel: copier dans le presse-papier
          navigator.clipboard.writeText(`${lat}, ${lng}`)
            .then(() => {
              // Indiquer visuellement que les coordonnées ont été copiées
              showCoordsBtn.innerHTML = '✓ Coordonnées copiées';
              setTimeout(() => {
                showCoordsBtn.innerHTML = '📍 Coordonnées exactes';
              }, 2000);
            })
            .catch(err => console.error('Erreur lors de la copie:', err));
        },
        function(error) {
          loadingSection.classList.add('hidden');
          alert('Impossible de détecter votre position. Veuillez l\'entrer manuellement.');
          console.error('Erreur de géolocalisation:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
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
      
      // Ajouter un timestamp pour éviter le cache côté API
      const timestamp = Date.now();
      
      // Récupérer les coordonnées depuis les adresses avec le paramètre nocache
      Promise.all([
        getCoordinates(currentLocationInput.value || 'Ma position', {nocache: timestamp}).catch(err => {
          console.error("Erreur avec l'adresse de départ:", err);
          throw new Error("L'adresse de départ n'a pas pu être localisée. Veuillez la préciser.");
        }),
        getCoordinates(destinationInput.value, {nocache: timestamp}).catch(err => {
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
      // Cacher le loader
      loadingSection.classList.add('hidden');  // ✅ Utiliser loadingSection comme défini au début du script
      
      // Afficher la recommandation principale
      let recommendationHTML = '';
      if (result.recommendation) {
        recommendationHTML = `
          <div class="result-yes">
            <p class="decision-text decision-yes">OUI, prenez un Vélib</p>
            <p class="decision-details">
              Temps estimé: ${result.duration.velibText}<br>
              Alternative: ${result.duration.alternativeText}
            </p>
          </div>
        `;
      } else {
        recommendationHTML = `
          <div class="result-no">
            <p class="decision-text decision-no">NON, évitez le Vélib</p>
            <p class="decision-details">
              ${result.reason}<br>
              ${result.alternative ? 'Alternative: ' + result.alternative.mode + ' (' + result.alternative.durationText + ')' : ''}
            </p>
          </div>
        `;
      }
      recommendationDiv.innerHTML = recommendationHTML;  // ✅ Utiliser recommendationDiv comme défini au début
      
      // MODIFICATION: Toujours afficher les stations s'il y en a, peu importe la recommandation
      if ((result.departureStations && result.departureStations.length > 0) || 
          (result.arrivalStations && result.arrivalStations.length > 0)) {
        
        // Afficher les stations de départ
        departureStationsList.innerHTML = '';
        
        if (result.departureStations && result.departureStations.length > 0) {
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
          document.querySelector('.departure-stations').classList.remove('hidden');
        } else {
          document.querySelector('.departure-stations').classList.add('hidden');
        }
        
        // Afficher les stations d'arrivée
        arrivalStationsList.innerHTML = '';
        
        if (result.arrivalStations && result.arrivalStations.length > 0) {
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
          document.querySelector('.arrival-stations').classList.remove('hidden');
        } else {
          document.querySelector('.arrival-stations').classList.add('hidden');
        }
        
        stationsList.classList.remove('hidden');
      } else {
        stationsList.classList.add('hidden');
      }
      
      // Afficher l'alternative si nécessaire
      if (!result.recommendation) {
        // Afficher les alternatives
        if (result.alternative) {
          let alternativeHTML = `
            <div class="alternative-item">
              <p class="alternative-name">${result.alternative.mode}</p>
              <p class="alternative-detail">
                Durée estimée: ${result.alternative.durationText}
              </p>`;
        
          // Ajouter les détails sur le temps de marche et d'attente si disponibles
          if (result.alternative.details) {
            alternativeHTML += `<p class="alternative-breakdown">${result.alternative.details}</p>`;
          }
          
          alternativeHTML += `
              <p>${result.alternative.description || ''}</p>
            </div>
          `;
          
          alternativeContent.innerHTML = alternativeHTML;
          alternativeSection.classList.remove('hidden');
        } else {
          alternativeSection.classList.add('hidden');
        }
      } else {
        alternativeSection.classList.add('hidden');
      }
      
      // Afficher la section des résultats
      resultSection.classList.remove('hidden');
      
      // Ajout d'un lien pour voir toutes les stations trouvées dans la console
      if (result.allDepartureStations && result.allDepartureStations.length > 0 ||
          result.allArrivalStations && result.allArrivalStations.length > 0) {
        
        const showAllStationsLink = document.createElement('a');
        showAllStationsLink.href = "#";
        showAllStationsLink.className = "show-all-stations";
        showAllStationsLink.textContent = "Voir toutes les stations trouvées";
        showAllStationsLink.addEventListener('click', function(e) {
          e.preventDefault();
          console.log("Toutes les stations de départ trouvées:", result.allDepartureStations || []);
          console.log("Toutes les stations d'arrivée trouvées:", result.allArrivalStations || []);
          
          // Réordonner les stations par distance
          const allDepartureByDistance = [...(result.allDepartureStations || [])].sort((a, b) => a.distance - b.distance);
          const allArrivalByDistance = [...(result.allArrivalStations || [])].sort((a, b) => a.distance - b.distance);
          
          // Afficher les 10 plus proches
          console.table(allDepartureByDistance.slice(0, 10).map(s => ({
            nom: s.name,
            distance: s.distanceText,
            temps: s.durationText,
            vélos: s.bikes
          })));
          
          console.table(allArrivalByDistance.slice(0, 10).map(s => ({
            nom: s.name,
            distance: s.distanceText,
            temps: s.durationText,
            places: s.docks
          })));
          
          alert("Liste complète des stations affichée dans la console (F12)");
        });
        
        stationsList.appendChild(showAllStationsLink);
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

    // Fonction de débogage pour vérifier les stations près d'une adresse
    function debugCheckStations() {
      const debugButton = document.createElement('button');
      debugButton.textContent = '🔍 Vérifier les stations';
      debugButton.classList.add('secondary-btn');
      debugButton.style.marginTop = '10px';
      
      debugButton.addEventListener('click', function() {
        const locationInput = currentLocationInput.value;
        if (!locationInput) {
          alert("Veuillez entrer une adresse de départ");
          return;
        }
        
        loadingSection.classList.remove('hidden');
        
        getCoordinates(locationInput)
          .then(coords => {
            return getNearbyVelibStations(coords, 1500);
          })
          .then(stations => {
            loadingSection.classList.add('hidden');
            
            if (!stations || stations.length === 0) {
              alert("Aucune station trouvée près de cette adresse dans un rayon de 1500m");
              return;
            }
            
            // Afficher les stations
            const stationsInfo = stations
              .map(s => `${s.name}: ${s.bikes} vélos, ${s.docks} places (à ${s.distanceText})`)
              .join('\n');
              
            console.log("Stations trouvées:", stations);
            alert(`${stations.length} stations trouvées près de ${locationInput}:\n${stationsInfo}`);
          })
          .catch(error => {
            loadingSection.classList.add('hidden');
            alert(`Erreur: ${error.message}`);
          });
      });
      
      // Ajouter le bouton en bas de l'interface
      document.querySelector('footer').insertAdjacentElement('beforebegin', debugButton);
    }

    // Activer le mode debug en environnement de développement
    if (location.hostname === 'localhost' || chrome.runtime.id === 'ggpjhpnddgcmbmjhilikiomlfjeecggf') {
      debugCheckStations();
    }
});
