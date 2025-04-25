/**
 * Module d'analyse et de décision pour les trajets Vélib
 */

/**
 * Effectue une analyse complète d'un trajet potentiel en Vélib
 * 
 * @param {Object} origin - {lat, lng} du point de départ 
 * @param {Object} destination - {lat, lng} du point d'arrivée
 * @returns {Promise<Object>} - Résultat de l'analyse
 */
function analyzeVelibJourney(origin, destination) {
    // 1. Calcul de la distance directe
    const directDistance = calculateHaversineDistance(
      origin.lat, origin.lng,
      destination.lat, destination.lng
    );
    
    // 2. Vérification préliminaire de la distance
    if (directDistance < 500) {
      return Promise.resolve({
        recommendation: false,
        reason: "La distance est trop courte, la marche est préférable.",
        alternative: {
          mode: "🚶‍♂️ Marche",
          duration: directDistance / 1.2, // Vitesse moyenne 1.2 m/s
          durationText: formatDuration(directDistance / 1.2),
          description: "Profitez d'une courte marche de quelques minutes."
        }
      });
    }
    
    // 3. Récupérer les stations de départ à proximité
    return getNearbyVelibStations(origin)
      .then(departureStations => {
        // S'il n'y a pas de stations près du point de départ
        if (departureStations.length === 0) {
          return getTransportAlternatives(origin, destination)
            .then(alternative => ({
              recommendation: false,
              reason: "Aucune station Vélib à proximité de votre point de départ.",
              alternative
            }));
        }
        
        // Filtrer les stations avec des vélos disponibles
        const availableStations = departureStations.filter(s => s.bikes > 0);
        
        if (availableStations.length === 0) {
          return getTransportAlternatives(origin, destination)
            .then(alternative => ({
              recommendation: false,
              reason: "Aucun vélo disponible dans les stations à proximité.",
              alternative
            }));
        }
        
        // 4. Récupérer les stations d'arrivée à proximité
        return getNearbyVelibStations(destination)
          .then(arrivalStations => {
            // S'il n'y a pas de stations près de la destination
            if (arrivalStations.length === 0) {
              return getTransportAlternatives(origin, destination)
                .then(alternative => ({
                  recommendation: false,
                  reason: "Aucune station Vélib à proximité de votre destination.",
                  alternative
                }));
            }
            
            // Filtrer les stations avec des emplacements disponibles
            const availableDocks = arrivalStations.filter(s => s.docks > 0);
            
            if (availableDocks.length === 0) {
              return getTransportAlternatives(origin, destination)
                .then(alternative => ({
                  recommendation: false,
                  reason: "Aucun emplacement libre près de votre destination.",
                  alternative
                }));
            }
            
            // 5. Calculer l'itinéraire à vélo
            return calculateRoute(origin, destination, 'cycling-regular')
              .then(cyclingRoute => {
                // 6. Calculer l'alternative de transport
                return getTransportAlternatives(origin, destination)
                  .then(alternative => {
                    // 7. Déterminer les temps d'accès aux stations
                    return Promise.all(
                      availableStations.slice(0, 3).map(station => {
                        const stationPos = { lat: station.lat, lng: station.lng };
                        return calculateRoute(origin, stationPos, 'foot-walking')
                          .then(walkRoute => ({
                            ...station,
                            distanceText: walkRoute.distanceText,
                            durationText: walkRoute.durationText,
                            walkDuration: walkRoute.duration
                          }));
                      })
                    ).then(departureWithWalk => {
                      return Promise.all(
                        availableDocks.slice(0, 3).map(station => {
                          const stationPos = { lat: station.lat, lng: station.lng };
                          return calculateRoute(stationPos, destination, 'foot-walking')
                            .then(walkRoute => ({
                              ...station,
                              distanceText: walkRoute.distanceText,
                              durationText: walkRoute.durationText,
                              walkDuration: walkRoute.duration
                            }));
                        })
                      ).then(arrivalWithWalk => {
                        // 8. Calcul du temps total Vélib
                        const bestDepartureStation = departureWithWalk.sort((a, b) => 
                          (a.walkDuration + (a.bikes > 2 ? 0 : 120)) - 
                          (b.walkDuration + (b.bikes > 2 ? 0 : 120))
                        )[0];
                        
                        const bestArrivalStation = arrivalWithWalk.sort((a, b) => 
                          (a.walkDuration + (a.docks > 2 ? 0 : 120)) - 
                          (b.walkDuration + (b.docks > 2 ? 0 : 120))
                        )[0];
                        
                        const totalVelibTime = bestDepartureStation.walkDuration + 
                          cyclingRoute.duration + 
                          bestArrivalStation.walkDuration + 
                          60; // 60s pour déverrouiller/verrouiller
                        
                        // 9. Prendre la décision
                        const velibFaster = totalVelibTime < alternative.duration * 1.2; // 20% de marge
                        const longEnough = directDistance > 1000; // Plus d'1km
                        const tooLong = directDistance > 7000; // Plus de 7km
                        
                        const hillFactor = (cyclingRoute.ascent > 100) ? 
                          " La montée est significative." : "";
                        
                        if (velibFaster && longEnough && !tooLong) {
                          return {
                            recommendation: true,
                            reason: `Le Vélib est plus rapide que les alternatives.${hillFactor}`,
                            departureStations: departureWithWalk
                              .sort((a, b) => a.walkDuration - b.walkDuration),
                            arrivalStations: arrivalWithWalk
                              .sort((a, b) => a.walkDuration - b.walkDuration),
                            routeInfo: cyclingRoute,
                            totalTime: totalVelibTime,
                            totalTimeText: formatDuration(totalVelibTime)
                          };
                        } else {
                          let reason = "Le Vélib n'est pas recommandé car ";
                          
                          if (!velibFaster) {
                            reason += "les transports en commun sont plus rapides.";
                          } else if (!longEnough) {
                            reason += "la distance est trop courte, la marche est préférable.";
                          } else if (tooLong) {
                            reason += "la distance est trop longue pour un trajet confortable en Vélib.";
                          }
                          
                          return {
                            recommendation: false,
                            reason: reason + hillFactor,
                            alternative
                          };
                        }
                      });
                    });
                  });
              });
          });
      });
  }
  