export function describeMobileDockState({
  isNarrowViewport = false,
  mobileThreadOpen = false,
  modalOpen = false,
  scannerOpen = false,
  settingsOpen = false,
} = {}) {
  const currentView = scannerOpen
    ? "scan"
    : (settingsOpen ? "settings" : "deck");

  return {
    currentView,
    interactive: Boolean(isNarrowViewport && !mobileThreadOpen && !modalOpen),
  };
}
