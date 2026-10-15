/**
 * Module d'utilitaires pour l'extension
 */

// Espace insécable entre le nombre et l'unité : « 16 min » ne se coupe pas en fin de ligne
const NBSP = ' ';

/**
 * Formate une distance en texte lisible : « 250 m », « 1,5 km »
 * @param {number} meters - Distance en mètres
 * @return {string} Distance formatée
 */
export function formatDistance(meters) {
  const rounded = Math.round(meters);
  if (rounded < 1000) {
    return `${rounded}${NBSP}m`;
  }
  return `${(meters / 1000).toFixed(1).replace('.', ',')}${NBSP}km`;
}

/**
 * Formate une durée en texte lisible, à la minute la plus proche : « < 1 min », « 16 min », « 1 h 05 »
 * @param {number} seconds - Durée en secondes
 * @return {string} Durée formatée
 */
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return `<${NBSP}1${NBSP}min`;
  }
  if (minutes < 60) {
    return `${minutes}${NBSP}min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}${NBSP}h`
    : `${hours}${NBSP}h${NBSP}${String(remainingMinutes).padStart(2, '0')}`;
}

export function debounce(func, wait) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
