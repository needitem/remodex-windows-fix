export function getBrowserNotificationState(windowLike = globalThis, navigatorLike = globalThis.navigator) {
  const supported = typeof windowLike?.Notification === "function";
  return {
    permission: supported ? windowLike.Notification.permission : "unsupported",
    serviceWorkerSupported: Boolean(navigatorLike?.serviceWorker),
    supported,
  };
}

export async function requestBrowserNotificationPermission(windowLike = globalThis) {
  if (typeof windowLike?.Notification?.requestPermission !== "function") {
    return "unsupported";
  }
  return windowLike.Notification.requestPermission();
}

export async function sendBrowserNotification({
  body = "",
  navigatorLike = globalThis.navigator,
  requireHidden = true,
  tag,
  title,
  windowLike = globalThis,
} = {}) {
  const notificationState = getBrowserNotificationState(windowLike, navigatorLike);
  if (!notificationState.supported || notificationState.permission !== "granted") {
    return false;
  }

  if (requireHidden && windowLike?.document && !windowLike.document.hidden) {
    return false;
  }

  const options = {
    badge: "/app/icon.svg",
    body,
    icon: "/app/icon.svg",
    tag,
  };

  try {
    const registration = await navigatorLike?.serviceWorker?.ready;
    if (typeof registration?.showNotification === "function") {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {}

  try {
    new windowLike.Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

export function describeBrowserNotificationPermission(permission) {
  switch (permission) {
    case "granted":
      return "Enabled";
    case "denied":
      return "Blocked";
    case "default":
      return "Not requested";
    default:
      return "Unavailable";
  }
}
