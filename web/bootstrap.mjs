const APP_VERSION = "20260318a";
const CLEANUP_MARKER = `remodex-web.bootstrap-cleanup.${APP_VERSION}`;

const needsReload = await cleanupLegacyAppShell();
if (!needsReload) {
  await import(`./main.mjs?v=${APP_VERSION}`);
}

async function cleanupLegacyAppShell() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  let hadLegacyRegistration = false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) => (
      registration.scope.includes("/app/")
      || registration.scope.endsWith("/app")
    ));
    hadLegacyRegistration = appRegistrations.length > 0;
    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
  } catch {}

  try {
    if ("caches" in globalThis) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("remodex-web-deck-"))
          .map((key) => caches.delete(key))
      );
    }
  } catch {}

  try {
    if (hadLegacyRegistration && sessionStorage.getItem(CLEANUP_MARKER) !== "1") {
      sessionStorage.setItem(CLEANUP_MARKER, "1");
      window.location.replace(window.location.href);
      return true;
    }
    sessionStorage.removeItem(CLEANUP_MARKER);
  } catch {}

  return false;
}
