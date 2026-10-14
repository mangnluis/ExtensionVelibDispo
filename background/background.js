chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      settings: {
        minBikes: 1,
        minDocks: 1,
        maxWalkDistance: 500,
        preferElectric: false
      }
    });
  }
});
