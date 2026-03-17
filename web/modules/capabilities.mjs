export function collectBrowserCapabilities(windowLike, navigatorLike) {
  const secureContext = Boolean(windowLike?.isSecureContext);
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
        ? "QR image decoding is available through BarcodeDetector."
        : "BarcodeDetector is unavailable. Import the pairing JSON directly as a fallback.",
    },
    {
      label: "PWA Shell",
      detail: "serviceWorker" in navigatorLike
        ? "Service Worker is available for offline shell caching."
        : "Service Worker is unavailable in this browser.",
    },
    {
      label: "Web Push",
      detail: "PushManager" in windowLike
        ? "Web Push APIs exist, but they still need a server-side subscription flow."
        : "This browser does not expose PushManager.",
    },
  ];

  return {
    secureContext,
    items: capabilities,
  };
}
