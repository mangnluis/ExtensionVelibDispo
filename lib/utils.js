/**
 * Module d'utilitaires pour l'extension
 */

/**
 * Formate une distance en texte lisible
 * @param {number} meters - Distance en mètres
 * @return {string} Distance formatée
 */
export function formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters/1000).toFixed(1)}km`;
    }
  }
  
/**
 * Formate une durée en texte lisible
 * @param {number} seconds - Durée en secondes
 * @return {string} Durée formatée
 */
export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes > 0 ? remainingMinutes : ''}`;
  }
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

export function setStorageData(key, value) {
  return new Promise((resolve) => {
    const data = {};
    data[key] = value;
    chrome.storage.local.set(data, resolve);
  });
}

export function getStorageData(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key]);
    });
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
