// fairfox extension — background service worker.
//
// The worker's only job is to make the toolbar icon toggle the side
// panel. Without `setPanelBehavior` the icon click would do nothing;
// with it the panel opens (or closes) in whichever tab is active.

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
