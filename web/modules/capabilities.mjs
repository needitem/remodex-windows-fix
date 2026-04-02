export function collectBrowserCapabilities(windowLike, navigatorLike) {
  const secureContext = Boolean(windowLike?.isSecureContext);
  const notificationSupported = typeof windowLike?.Notification === "function";
  const capabilities = [
    {
      label: "Secure Context",
      detail: secureContext
        ? "HTTPS or localhost context is available for Web Crypto, camera access, and Service Worker."
        : "Move this app to HTTPS or localhost before wiring secure transport.",
    },
    {
      label: "Web Crypto",
      detail: windowLike?.crypto?.subtle
        ? "SubtleCrypto is available for the future clientHello/clientAuth implementation."
        : "SubtleCrypto is missing, so encrypted transport cannot work here.",
    },
    {
      label: "QR From Image",
      detail: "BarcodeDetector" in windowLike
        ? "QR decoding is available through BarcodeDetector, with jsQR as a fallback."
        : "BarcodeDetector is unavailable. This app falls back to jsQR for image and camera decoding.",
    },
    {
      label: "PWA Shell",
      detail: "serviceWorker" in navigatorLike
        ? "Service Worker is available for offline shell caching."
        : "Service Worker is unavailable in this browser.",
    },
    {
      label: "Browser Notifications",
      detail: notificationSupported
        ? "Browser notifications are available for local completion and approval alerts."
        : "This browser does not expose the Notification API.",
    },
  ];

  return {
    secureContext,
    items: capabilities,
  };
}
