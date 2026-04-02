// FILE: web-browser-notifications.test.js
// Purpose: Verifies browser notification helpers describe permission state and prefer service worker delivery.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/browser-notifications.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("browser notification helpers expose support and permission labels", async () => {
  const {
    describeBrowserNotificationPermission,
    getBrowserNotificationState,
  } = await import("../web/modules/browser-notifications.mjs");

  const state = getBrowserNotificationState(
    { Notification: class Notification {}, document: { hidden: true } },
    { serviceWorker: {} }
  );

  assert.equal(state.supported, true);
  assert.equal(state.serviceWorkerSupported, true);
  assert.equal(describeBrowserNotificationPermission("granted"), "Enabled");
  assert.equal(describeBrowserNotificationPermission("default"), "Not requested");
  assert.equal(describeBrowserNotificationPermission("denied"), "Blocked");
});

test("sendBrowserNotification prefers service worker notifications when permission is granted", async () => {
  const { sendBrowserNotification } = await import("../web/modules/browser-notifications.mjs");

  const delivered = [];
  class NotificationMock {
    static permission = "granted";
  }

  const sent = await sendBrowserNotification({
    body: "Background task finished.",
    navigatorLike: {
      serviceWorker: {
        ready: Promise.resolve({
          showNotification(title, options) {
            delivered.push({ options, title, via: "service-worker" });
            return Promise.resolve();
          },
        }),
      },
    },
    tag: "remodex-web:test",
    title: "Remodex Web",
    windowLike: {
      Notification: NotificationMock,
      document: { hidden: true },
    },
  });

  assert.equal(sent, true);
  assert.deepEqual(delivered, [
    {
      options: {
        badge: "/app/icon.svg",
        body: "Background task finished.",
        icon: "/app/icon.svg",
        tag: "remodex-web:test",
      },
      title: "Remodex Web",
      via: "service-worker",
    },
  ]);
});
