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
        // Vérifier que departureStations est bien un tableau
        if (!departureStations || !Array.isArray(departureStations)) {
          console.error("Les stations de départ ne sont pas un tableau valide:", departureStations);
          departureStations = [];
        }
        
        // S'il n'y a pas de stations près du point de départ
        if (departureStations.length === 0) {
          return getTransportAlternatives(origin, destination)
            .then(alternative => ({
              recommendation: false,
              reason: "Aucune station Vélib à proximité de votre point de départ.",
              alternative: alternative || {
                mode: "🚶‍♂️ Marche",
                durationText: "Variable",
                description: "Les stations Vélib sont trop éloignées. La marche ou les transports en commun sont recommandés."
              }
            }));
        }
        
        // Filtrer les stations avec des vélos disponibles
        const availableStations = departureStations.filter(s => s.bikes > 0);
        
        if (availableStations.length === 0) {
          return getTransportAlternatives(origin, destination)
            .then(alternative => ({
              recommendation: false,
              reason: "Aucun vélo disponible dans les stations à proximité.",
              alternative: alternative || {
                mode: "🚶‍♂️ Marche ou transport en commun",
                durationText: "Variable",
                description: "Aucun vélo disponible actuellement. Réessayez plus tard ou optez pour une alternative."
              }
            }));
        }
        
        // 4. Récupérer les stations d'arrivée à proximité
        return getNearbyVelibStations(destination)
          .then(arrivalStations => {
            // Vérifier que arrivalStations est bien un tableau
            if (!arrivalStations || !Array.isArray(arrivalStations)) {
              console.error("Les stations d'arrivée ne sont pas un tableau valide:", arrivalStations);
              arrivalStations = [];
            }
            
            // S'il n'y a pas de stations près du point d'arrivée
            if (arrivalStations.length === 0) {
              return getTransportAlternatives(origin, destination)
                .then(alternative => ({
                  recommendation: false,
                  reason: "Aucune station Vélib à proximité de votre destination.",
                  alternative: alternative || {
                    mode: "🚶‍♂️ Marche ou transport en commun",
                    durationText: "Variable",
                    description: "Les stations Vélib sont trop éloignées de votre destination."
                  }
                }));
            }
            
            // Filtrer les stations avec des emplacements disponibles
            const availableDocks = arrivalStations.filter(s => s.docks > 0);
            
            if (availableDocks.length === 0) {
              return getTransportAlternatives(origin, destination)
                .then(alternative => ({
                  recommendation: false,
                  reason: "Aucun emplacement disponible dans les stations à proximité de votre destination.",
                  alternative: alternative || {
                    mode: "🚶‍♂️ Marche ou transport en commun",
                    durationText: "Variable",
                    description: "Toutes les stations près de votre destination sont pleines. Réessayez plus tard."
                  }
                }));
            }
            
            // 5. Calculer l'itinéraire à vélo entre origine et destination
            return calculateRoute(origin, destination, 'cycling-regular')
              .then(bikeRoute => {
                // S'assurer que bikeRoute a les propriétés nécessaires
                if (!bikeRoute || !bikeRoute.duration || !bikeRoute.distance) {
                  throw new Error("Impossible de calculer l'itinéraire à vélo.");
                }
                
                // 6. Calculer l'itinéraire à pied et en transport en commun pour comparaison
                return getTransportAlternatives(origin, destination)
                  .then(alternative => {
                    
                    // Remplacer la section "7. Prendre une décision" par cette version plus robuste

                    // 7. Prendre une décision
                    try {
                      // Vérifier que les stations sont disponibles avant d'y accéder
                      if (!availableStations.length || !availableDocks.length) {
                        throw new Error("Pas assez de stations disponibles pour ce trajet");
                      }
                      
                      // Accès sécurisé aux données de stations
                      const departureWalkTime = availableStations[0].walkDuration || 300;
                      const arrivalWalkTime = availableDocks[0].walkDuration || 300;
                      
                      const velibTime = bikeRoute.duration + departureWalkTime + arrivalWalkTime + 300; // 5min buffer pour prendre/déposer le vélo
                      
                      // Log pour debug
                      console.log("Temps trajet vélib:", {
                        vélo: bikeRoute.duration,
                        marcheAuDépart: departureWalkTime,
                        marcheÀL_arrivée: arrivalWalkTime,
                        total: velibTime
                      });
                      
                      const shouldTakeVelib = alternative ? 
                        velibTime < alternative.duration * 1.2 : // 20% buffer
                        true;
                      
                      if (shouldTakeVelib) {
                        // Trier les stations par praticité
                        const bestDepartureStations = availableStations
                          .sort((a, b) => (a.walkDuration + (a.bikes < 3 ? 300 : 0)) - 
                                          (b.walkDuration + (b.bikes < 3 ? 300 : 0)))
                          .slice(0, 3);
                        
                        const bestArrivalStations = availableDocks
                          .sort((a, b) => (a.walkDuration + (a.docks < 3 ? 300 : 0)) - 
                                          (b.walkDuration + (b.docks < 3 ? 300 : 0)))
                          .slice(0, 3);
                        
                        return {
                          recommendation: true,
                          reason: `Le trajet en Vélib est plus rapide (${formatDuration(bikeRoute.duration)} de vélo + ${formatDuration(departureWalkTime + arrivalWalkTime)} de marche).`,
                          departureStations: bestDepartureStations,
                          arrivalStations: bestArrivalStations,
                          route: bikeRoute,
                          alternative: alternative
                        };
                      } else {
                        return {
                          recommendation: false,
                          reason: `Une alternative plus rapide existe.`,
                          alternative: alternative || {
                            mode: "🚶‍♂️ Marche",
                            duration: directDistance / 1.2,
                            durationText: formatDuration(directDistance / 1.2),
                            description: "La marche ou les transports en commun semblent plus pratiques pour ce trajet."
                          }
                        };
                      }
                    } catch (error) {
                      console.error("Erreur lors de la prise de décision:", error);
                      
                      // Analyser la distance pour proposer une alternative pertinente
                      if (directDistance > 8000) {
                        return {
                          recommendation: false,
                          reason: `La distance est importante (${formatDistance(directDistance)}), les transports en commun sont recommandés.`,
                          alternative: {
                            mode: "🚇 Transport en commun",
                            durationText: formatDuration(directDistance / (20000/3600) + 300),
                            description: "Pour cette distance, les transports en commun sont généralement plus pratiques que le vélo."
                          }
                        };
                      } else {
                        return {
                          recommendation: false,
                          reason: `Impossible de calculer un trajet Vélib fiable: ${error.message}`,
                          alternative: alternative || {
                            mode: "🚶‍♂️ Marche ou transport en commun",
                            durationText: "Variable",
                            description: "Les stations Vélib semblent trop éloignées ou indisponibles pour ce trajet."
                          }
                        };
                      }
                    }
                  });
              });
          });
      })
      .catch(error => {
        console.error("Erreur dans analyzeVelibJourney:", error);
        // Retourner un résultat d'erreur formaté
        return {
          recommendation: false,
          reason: "Erreur lors de l'analyse: " + (error.message || "Veuillez réessayer."),
          alternative: {
            mode: "🚶‍♂️ Marche ou transport en commun",
            durationText: "Non disponible",
            description: "Une erreur s'est produite. Veuillez réessayer ou opter pour une alternative."
          }
        };
      });
}
