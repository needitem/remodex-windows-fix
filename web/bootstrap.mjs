const APP_VERSION = "20260402k";
const CLEANUP_MARKER = `remodex-web.bootstrap-cleanup.${APP_VERSION}`;
const CURRENT_SW_PATH = "/app/sw.mjs";

globalThis.__REMODEX_APP_VERSION__ = APP_VERSION;

const needsReload = await cleanupLegacyAppShell();
if (!needsReload) {
  await import(`./main.mjs?v=${APP_VERSION}`);
  void registerAppShellServiceWorker();
}

async function cleanupLegacyAppShell() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  let hadLegacyRegistration = false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) => {
      if (!(registration.scope.includes("/app/") || registration.scope.endsWith("/app"))) {
        return false;
      }
      const scriptUrl = registration.active?.scriptURL
        || registration.waiting?.scriptURL
        || registration.installing?.scriptURL
        || "";
      return !isCurrentAppServiceWorkerScript(scriptUrl);
    });
    hadLegacyRegistration = appRegistrations.length > 0;
    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
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

function isCurrentAppServiceWorkerScript(scriptUrl) {
  if (!scriptUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(scriptUrl, window.location.origin);
    return parsedUrl.pathname === CURRENT_SW_PATH && parsedUrl.searchParams.get("v") === APP_VERSION;
  } catch {
    return scriptUrl.includes(`${CURRENT_SW_PATH}?v=${APP_VERSION}`);
  }
}

async function registerAppShellServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register(`/app/sw.mjs?v=${APP_VERSION}`, {
      scope: "/app/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}
