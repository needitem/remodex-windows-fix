export function createScannerController({
  navigatorLike = navigator,
  videoElement,
  windowLike = window,
} = {}) {
  const state = {
    canvas: null,
    decodeVideo: null,
    rafId: 0,
    stream: null,
  };

  async function start({ onDetect, onError, onStatus } = {}) {
    if (!navigatorLike.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable in this browser.");
    }
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
    state.canvas = null;
    videoElement.pause();
    videoElement.srcObject = null;
  }

  async function loop({ onDetect, onError, onStatus }) {
    if (!state.stream) {
      return;
    }

    try {
      if (videoElement.readyState >= 2) {
        const decodePairingPayloadTextFromVideo = await loadVideoDecoder();
        const rawValue = await decodePairingPayloadTextFromVideo(videoElement, {
          canvas: state.canvas || (state.canvas = windowLike.document.createElement("canvas")),
          windowLike,
        });
        if (rawValue) {
          onStatus?.("QR detected.");
          onDetect?.(rawValue);
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

  async function loadVideoDecoder() {
    if (typeof state.decodeVideo === "function") {
      return state.decodeVideo;
    }

    const module = await import("./qr-decoder.mjs");
    state.decodeVideo = module.decodePairingPayloadTextFromVideo;
    return state.decodeVideo;
  }
}
