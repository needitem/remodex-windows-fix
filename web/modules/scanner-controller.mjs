export function createScannerController({
  navigatorLike = navigator,
  videoElement,
  windowLike = window,
} = {}) {
  const state = {
    detector: null,
    rafId: 0,
    stream: null,
  };

  async function start({ onDetect, onError, onStatus } = {}) {
    if (!navigatorLike.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable in this browser.");
    }
    if (!("BarcodeDetector" in windowLike)) {
      throw new Error("BarcodeDetector is unavailable. Import the QR image instead.");
    }

    state.detector = new windowLike.BarcodeDetector({ formats: ["qr_code"] });
    state.stream = await navigatorLike.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });

    videoElement.srcObject = state.stream;
    await videoElement.play();
    onStatus?.("Point the camera at the CLI QR.");
    loop({ onDetect, onError, onStatus });
  }

  function stop() {
    windowLike.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    if (state.stream) {
      for (const track of state.stream.getTracks()) {
        track.stop();
      }
    }
    state.stream = null;
    state.detector = null;
    videoElement.pause();
    videoElement.srcObject = null;
  }

  async function loop({ onDetect, onError, onStatus }) {
    if (!state.stream || !state.detector) {
      return;
    }

    try {
      if (videoElement.readyState >= 2) {
        const codes = await state.detector.detect(videoElement);
        if (codes.length && codes[0].rawValue) {
          onStatus?.("QR detected.");
          onDetect?.(codes[0].rawValue);
          return;
        }
      }
    } catch (error) {
      onError?.(error);
      stop();
      return;
    }

    state.rafId = windowLike.requestAnimationFrame(() => {
      windowLike.setTimeout(() => {
        void loop({ onDetect, onError, onStatus });
      }, 240);
    });
  }

  return {
    start,
    stop,
  };
}
