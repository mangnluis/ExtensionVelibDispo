/**
 * Module d'utilitaires pour l'extension
 */

/**
 * Formate une distance en texte lisible
 * @param {number} meters - Distance en mètres
 * @return {string} Distance formatée
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
   * @param {number} seconds - Durée en secondes
   * @return {string} Durée formatée
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
  
  // Vérifier que cette fonction est bien présente et correcte

  /**
   * Limite le nombre d'appels à une fonction dans un intervalle de temps
   * @param {Function} func - Fonction à limiter
   * @param {number} wait - Intervalle en ms
   * @return {Function} Fonction limitée
   */
  function debounce(func, wait) {
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
  
  /**
   * Stocke des données dans le stockage local de l'extension
   * @param {string} key - Clé de stockage
   * @param {*} value - Valeur à stocker
   * @return {Promise} Promise résolue après le stockage
   */
  function setStorageData(key, value) {
    return new Promise((resolve) => {
      const data = {};
      data[key] = value;
      chrome.storage.local.set(data, resolve);
    });
  }
  
  /**
   * Récupère des données depuis le stockage local de l'extension
   * @param {string} key - Clé de stockage
   * @return {Promise<*>} Valeur stockée
   */
  function getStorageData(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key]);
      });
    });
  }
