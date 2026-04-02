export function createAnimationFrameBatcher(run, {
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
} = {}) {
  let frameHandle = null;
  let generation = 0;

  function cancel() {
    generation += 1;
    if (frameHandle != null && typeof cancelFrame === "function") {
      cancelFrame(frameHandle);
    }
    frameHandle = null;
  }

  function flush() {
    if (frameHandle == null) {
      return;
    }

    cancel();
    run();
  }

  function schedule() {
    if (frameHandle != null) {
      return;
    }

    if (typeof requestFrame !== "function") {
      run();
      return;
    }

    const ticket = generation + 1;
    generation = ticket;
    frameHandle = requestFrame(() => {
      if (generation !== ticket) {
        return;
      }
      frameHandle = null;
      run();
    });
  }

  return {
    cancel,
    flush,
    hasPending() {
      return frameHandle != null;
    },
    schedule,
  };
}

export function createDeferredStorageWriter(write, {
  cancelIdleCallback = globalThis.cancelIdleCallback?.bind(globalThis),
  clearTimeout = globalThis.clearTimeout?.bind(globalThis),
  debounceMs = 180,
  requestIdleCallback = globalThis.requestIdleCallback?.bind(globalThis),
  setTimeout = globalThis.setTimeout?.bind(globalThis),
} = {}) {
  let idleHandle = null;
  let pending = false;
  let timeoutHandle = null;
  let token = 0;

  function clearPendingWork() {
    token += 1;
    if (idleHandle != null && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(idleHandle);
    }
    if (timeoutHandle != null && typeof clearTimeout === "function") {
      clearTimeout(timeoutHandle);
    }
    idleHandle = null;
    timeoutHandle = null;
  }

  function runIfCurrent(expectedToken) {
    if (!pending || token !== expectedToken) {
      return;
    }

    pending = false;
    idleHandle = null;
    timeoutHandle = null;
    write();
  }

  function schedule() {
    if (typeof setTimeout !== "function") {
      write();
      return;
    }

    pending = true;
    clearPendingWork();
    const expectedToken = token;
    timeoutHandle = setTimeout(() => {
      timeoutHandle = null;
      if (!pending || token !== expectedToken) {
        return;
      }

      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(() => {
          runIfCurrent(expectedToken);
        });
        return;
      }

      runIfCurrent(expectedToken);
    }, debounceMs);
  }

  function flush() {
    if (!pending) {
      return;
    }

    clearPendingWork();
    pending = false;
    write();
  }

  function cancel() {
    pending = false;
    clearPendingWork();
  }

  return {
    cancel,
    flush,
    hasPending() {
      return pending;
    },
    schedule,
  };
}
