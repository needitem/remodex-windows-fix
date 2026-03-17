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

  const jsQR = readJsQR(windowLike);
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
