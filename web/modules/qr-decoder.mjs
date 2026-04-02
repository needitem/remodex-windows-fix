const JSQR_SCRIPT_PATH = "/app/vendor/jsqr.js";
let jsqrLoadPromise = null;

export async function decodePairingPayloadTextFromImageFile(file, {
  windowLike = window,
} = {}) {
  const bitmap = await windowLike.createImageBitmap(file);
  try {
    return await decodeQRCodeFromSource(bitmap, {
      height: bitmap.height,
      width: bitmap.width,
      windowLike,
    });
  } finally {
    bitmap.close?.();
  }
}

export async function decodePairingPayloadTextFromVideo(videoElement, {
  canvas,
  windowLike = window,
} = {}) {
  const width = videoElement.videoWidth || videoElement.clientWidth;
  const height = videoElement.videoHeight || videoElement.clientHeight;
  if (!width || !height) {
    return "";
  }

  return decodeQRCodeFromSource(videoElement, {
    canvas,
    height,
    width,
    windowLike,
  });
}

async function decodeQRCodeFromSource(source, {
  canvas = null,
  height,
  width,
  windowLike = window,
} = {}) {
  const barcodeDetectorResult = await tryBarcodeDetector(source, windowLike);
  if (barcodeDetectorResult) {
    return barcodeDetectorResult;
  }

  const jsQR = await ensureJsQRLoaded(windowLike);
  if (typeof jsQR !== "function") {
    throw new Error("QR decoder is unavailable in this browser.");
  }

  const workingCanvas = canvas || windowLike.document.createElement("canvas");
  workingCanvas.width = width;
  workingCanvas.height = height;
  const context = workingCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not prepare a QR decoding canvas.");
  }

  context.drawImage(source, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const result = jsQR(imageData.data, width, height, {
    inversionAttempts: "attemptBoth",
  });
  return result?.data || "";
}

async function tryBarcodeDetector(source, windowLike) {
  if (!("BarcodeDetector" in windowLike)) {
    return "";
  }

  try {
    const detector = new windowLike.BarcodeDetector({ formats: ["qr_code"] });
    const barcodes = await detector.detect(source);
    return barcodes[0]?.rawValue || "";
  } catch {
    return "";
  }
}

function readJsQR(windowLike) {
  return windowLike.jsQR || globalThis.jsQR || null;
}

export async function ensureJsQRLoaded(windowLike = window) {
  const existing = readJsQR(windowLike);
  if (typeof existing === "function") {
    return existing;
  }

  const documentLike = windowLike?.document;
  const appendTarget = documentLike?.head || documentLike?.body || documentLike?.documentElement;
  if (!documentLike?.createElement || !appendTarget) {
    return null;
  }

  if (!jsqrLoadPromise) {
    jsqrLoadPromise = new Promise((resolve, reject) => {
      const scriptUrl = resolveJsQRScriptUrl(windowLike);
      const selector = 'script[data-remodex-jsqr="1"]';
      const existingScript = documentLike.querySelector?.(selector);
      const script = existingScript || documentLike.createElement("script");

      const cleanup = () => {
        script.removeEventListener?.("load", handleLoad);
        script.removeEventListener?.("error", handleError);
      };

      const finishResolve = () => {
        cleanup();
        const loaded = readJsQR(windowLike);
        if (typeof loaded === "function") {
          resolve(loaded);
          return;
        }
        jsqrLoadPromise = null;
        reject(new Error("QR decoder is unavailable in this browser."));
      };

      const handleLoad = () => {
        script.dataset.loaded = "1";
        finishResolve();
      };

      const handleError = () => {
        cleanup();
        jsqrLoadPromise = null;
        reject(new Error("Could not load the QR decoder bundle."));
      };

      if (existingScript) {
        if (existingScript.dataset.loaded === "1") {
          finishResolve();
          return;
        }
        existingScript.addEventListener?.("load", handleLoad, { once: true });
        existingScript.addEventListener?.("error", handleError, { once: true });
        return;
      }

      script.async = true;
      script.defer = true;
      script.dataset.remodexJsqr = "1";
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      script.src = scriptUrl;
      appendTarget.append(script);
    });
  }

  return jsqrLoadPromise;
}

export function resolveJsQRScriptUrl(windowLike = window) {
  const version = String(windowLike?.__REMODEX_APP_VERSION__ || "").trim();
  return version ? `${JSQR_SCRIPT_PATH}?v=${encodeURIComponent(version)}` : JSQR_SCRIPT_PATH;
}
