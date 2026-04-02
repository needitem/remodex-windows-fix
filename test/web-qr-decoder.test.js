// FILE: web-qr-decoder.test.js
// Purpose: Verifies jsQR loading is deferred until QR decoding actually needs the fallback bundle.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/qr-decoder.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("resolveJsQRScriptUrl appends the current app version when present", async () => {
  const { resolveJsQRScriptUrl } = await import(`../web/modules/qr-decoder.mjs?case=${Date.now()}`);

  assert.equal(
    resolveJsQRScriptUrl({ __REMODEX_APP_VERSION__: "20260402e" }),
    "/app/vendor/jsqr.js?v=20260402e"
  );
});

test("ensureJsQRLoaded reuses an existing jsQR global without injecting a script", async () => {
  const { ensureJsQRLoaded } = await import(`../web/modules/qr-decoder.mjs?case=${Date.now()}`);
  const jsQR = () => "decoded";
  let createElementCount = 0;

  const result = await ensureJsQRLoaded({
    document: {
      createElement() {
        createElementCount += 1;
        return {};
      },
      head: {
        append() {
          throw new Error("script injection should not run when jsQR is already present");
        },
      },
    },
    jsQR,
  });

  assert.equal(result, jsQR);
  assert.equal(createElementCount, 0);
});

test("ensureJsQRLoaded injects the vendor script once and resolves the shared loader promise", async () => {
  const { ensureJsQRLoaded } = await import(`../web/modules/qr-decoder.mjs?case=${Date.now()}`);
  const appendedScripts = [];
  const windowLike = createFakeWindowLike((script) => {
    appendedScripts.push(script.src);
    windowLike.jsQR = () => "decoded";
    script.dispatch("load");
  });

  const [first, second] = await Promise.all([
    ensureJsQRLoaded(windowLike),
    ensureJsQRLoaded(windowLike),
  ]);

  assert.equal(typeof first, "function");
  assert.equal(first, second);
  assert.deepEqual(appendedScripts, ["/app/vendor/jsqr.js"]);
});

function createFakeWindowLike(onAppend) {
  return {
    document: {
      createElement() {
        return createFakeScriptElement();
      },
      head: {
        append(script) {
          onAppend(script);
        },
      },
      querySelector() {
        return null;
      },
    },
  };
}

function createFakeScriptElement() {
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
}
