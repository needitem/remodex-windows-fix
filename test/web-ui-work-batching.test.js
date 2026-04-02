// FILE: web-ui-work-batching.test.js
// Purpose: Verifies animation-frame batching and deferred storage writes coalesce hot UI work.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/ui-work-batching.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("createAnimationFrameBatcher coalesces repeated schedules into one render", async () => {
  const { createAnimationFrameBatcher } = await import("../web/modules/ui-work-batching.mjs");
  const frames = [];
  let renderCount = 0;

  const batcher = createAnimationFrameBatcher(() => {
    renderCount += 1;
  }, {
    cancelFrame(frameId) {
      frames[frameId - 1] = null;
    },
    requestFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  });

  batcher.schedule();
  batcher.schedule();

  assert.equal(frames.length, 1);
  assert.equal(renderCount, 0);

  frames[0]?.();
  assert.equal(renderCount, 1);
});

test("createAnimationFrameBatcher flushes a pending render exactly once", async () => {
  const { createAnimationFrameBatcher } = await import("../web/modules/ui-work-batching.mjs");
  const frames = [];
  let renderCount = 0;

  const batcher = createAnimationFrameBatcher(() => {
    renderCount += 1;
  }, {
    cancelFrame(frameId) {
      frames[frameId - 1] = null;
    },
    requestFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  });

  batcher.schedule();
  batcher.flush();

  assert.equal(renderCount, 1);
  frames[0]?.();
  assert.equal(renderCount, 1);
});

test("createDeferredStorageWriter debounces repeated writes until idle time", async () => {
  const { createDeferredStorageWriter } = await import("../web/modules/ui-work-batching.mjs");
  const timeouts = new Map();
  let idleCallback = null;
  let nextTimerId = 0;
  let writeCount = 0;

  const writer = createDeferredStorageWriter(() => {
    writeCount += 1;
  }, {
    cancelIdleCallback() {
      idleCallback = null;
    },
    clearTimeout(timeoutId) {
      timeouts.delete(timeoutId);
    },
    requestIdleCallback(callback) {
      idleCallback = callback;
      return "idle";
    },
    setTimeout(callback, delay) {
      nextTimerId += 1;
      timeouts.set(nextTimerId, { callback, delay });
      return nextTimerId;
    },
  });

  writer.schedule();
  writer.schedule();

  assert.equal(timeouts.size, 1);
  assert.equal(writeCount, 0);

  const [{ callback, delay }] = [...timeouts.values()];
  assert.equal(delay, 180);
  callback();

  assert.equal(writeCount, 0);
  assert.equal(typeof idleCallback, "function");

  idleCallback?.();
  assert.equal(writeCount, 1);
});

test("createDeferredStorageWriter flushes pending writes synchronously", async () => {
  const { createDeferredStorageWriter } = await import("../web/modules/ui-work-batching.mjs");
  const timeouts = new Map();
  let nextTimerId = 0;
  let writeCount = 0;

  const writer = createDeferredStorageWriter(() => {
    writeCount += 1;
  }, {
    clearTimeout(timeoutId) {
      timeouts.delete(timeoutId);
    },
    setTimeout(callback) {
      nextTimerId += 1;
      timeouts.set(nextTimerId, callback);
      return nextTimerId;
    },
  });

  writer.schedule();
  writer.flush();

  assert.equal(writeCount, 1);
  assert.equal(timeouts.size, 0);
});
