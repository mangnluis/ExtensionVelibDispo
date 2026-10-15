/**
 * Réglages de l'extension : constantes métier et accès aux services
 */

/** Vitesse de marche appliquée aux distances à vol d'oiseau, détours compris (m/s, ≈ 4,3 km/h) */
export const WALKING_SPEED = 1.2;

/** Vitesse moyenne d'un Vélib en ville, quand OpenRouteService ne répond pas (m/s) */
export const BIKE_SPEED = 15 / 3.6;

/** Allongement d'un itinéraire par rapport à la distance à vol d'oiseau */
export const ROUTE_DETOUR_FACTOR = 1.2;

/** Temps pour décrocher puis raccrocher le vélo (s) */
export const DOCKING_TIME = 120;

/** Temps de prise/dépose retenu pour les trajets à vélo de moins de SHORT_TRIP_DISTANCE mètres (s) */
export const SHORT_TRIP_DOCKING_TIME = 60;
export const SHORT_TRIP_DISTANCE = 2000;

/** En deçà de cette distance (m), mieux vaut marcher */
export const MIN_DISTANCE_FOR_VELIB = 500;

/** Au-delà de cette distance (m), mieux vaut les transports en commun */
export const MAX_DISTANCE_FOR_VELIB = 10000;

/** Rayon de recherche des stations autour d'un point (m) */
export const STATION_SEARCH_RADIUS = 1500;

/**
 * Clé OpenRouteService. Elle est publique (code et historique git) et son quota est partagé
 * par tous les utilisateurs : voir L3 dans CLAUDE.md.
 */
export const ORS_API_KEY = '5b3ce3597851110001cf6248e7c9fd072c7e4c1fb3d4b984310cc1cd';
