import { test, expect } from "@playwright/test";

const sessionResponse = {
  session: {
    id: "test-session",
    status: "active",
    alarmPattern: "siren",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    resolvedAt: null,
    location: null,
    trustedContacts: [],
  },
  accessToken: "test-token",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class FakeAudioParam {
      setValueAtTime() {}
      cancelScheduledValues() {}
      exponentialRampToValueAtTime() {}
    }

    class FakeNode {
      connect() { return this; }
      disconnect() {}
      start() {}
      stop() {}
    }

    class FakeAudioContext {
      constructor() {
        this.state = "running";
        this.currentTime = 0;
        this.destination = new FakeNode();
      }
      createGain() {
        const node = new FakeNode();
        node.gain = new FakeAudioParam();
        return node;
      }
      createOscillator() {
        const node = new FakeNode();
        node.frequency = new FakeAudioParam();
        node.detune = { value: 0 };
        node.type = "sine";
        return node;
      }
      createBuffer() { return {}; }
      createBufferSource() {
        const node = new FakeNode();
        node.buffer = null;
        return node;
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
  });

  let freeUses = 0;
  let unlimited = false;

  const accessSnapshot = () => ({
    visitorId: "browser-test-visitor",
    freeUses,
    freeUseLimit: 3,
    remainingFreeUses: unlimited ? null : Math.max(0, 3 - freeUses),
    creator: false,
    unlimited,
    paid: unlimited,
    locked: !unlimited && freeUses >= 3,
    unlockedAt: unlimited ? new Date().toISOString() : null,
  });

  await page.route("**/api/siren-access**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access: accessSnapshot() }),
      });
      return;
    }

    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}

    if (body.action === "bootstrap") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "browser-test-visitor.secret-token",
          access: accessSnapshot(),
        }),
      });
      return;
    }

    if (body.action === "consume") {
      if (unlimited) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            allowed: true,
            counted: false,
            paymentRequired: false,
            access: accessSnapshot(),
          }),
        });
        return;
      }

      if (freeUses >= 3) {
        await route.fulfill({
          status: 402,
          contentType: "application/json",
          body: JSON.stringify({
            allowed: false,
            paymentRequired: true,
            access: accessSnapshot(),
          }),
        });
        return;
      }

      freeUses += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          allowed: true,
          counted: true,
          paymentRequired: false,
          access: accessSnapshot(),
        }),
      });
      return;
    }

    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unsupported action" }),
    });
  });

  await page.route("**/api/paypal/create-order**", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        orderId: "ORDER-1",
        status: "CREATED",
        approvalUrl: "https://www.paypal.com/checkoutnow?token=ORDER-1",
        amount: { value: "5.00", currency: "USD" },
      }),
    });
  });

  await page.route("**/api/paypal/capture-order**", async (route) => {
    unlimited = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        unlocked: true,
        access: accessSnapshot(),
        paypal: {
          orderId: "ORDER-1",
          captureId: "CAPTURE-1",
          status: "COMPLETED",
        },
      }),
    });
  });

  await page.route("**/api/safety-sessions**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(sessionResponse),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: sessionResponse.session }),
    });
  });

  await page.route("**/api/safety-notify**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sent: 1, failed: 0, results: [] }),
    });
  });

  await page.route("**/api/official-alerts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: { name: "National Weather Service Alerts API", official: true },
        count: 1,
        alerts: [{
          id: "test-alert",
          event: "Child Abduction Emergency",
          headline: "Test fixture child abduction alert",
          description: "Browser smoke-test fixture.",
          instruction: "Use official instructions.",
          area: "Test Area",
          senderName: "Official Test Fixture",
          expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          officialUrl: "https://www.weather.gov/",
        }],
      }),
    });
  });
});

test("loads the emergency interface and starts/stops the local siren", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Activate Siren");
  await expect(page.getByRole("button", { name: /ACTIVATE SIREN/i })).toBeVisible();

  await page.getByRole("button", { name: /ACTIVATE SIREN/i }).click();
  await expect(page.getByRole("button", { name: /STOP ALARM/i })).toBeVisible();
  await expect(page.locator("#statusText")).toContainText("Alarm active");
  await expect.poll(async () => page.locator("#alarmAudio").evaluate((audio) => ({
    paused: audio.paused,
    src: audio.currentSrc || audio.src,
    readyState: audio.readyState
  }))).toMatchObject({
    paused: false
  });
  const mediaState = await page.locator("#alarmAudio").evaluate((audio) => ({
    src: audio.currentSrc || audio.src,
    readyState: audio.readyState,
    currentTime: audio.currentTime
  }));
  expect(mediaState.src).toMatch(/\/audio\/siren-(?:ios-v3\.m4a|fallback-v3\.mp3|44k-v2\.wav)$/);

  if (testInfo.project.name === "firefox-desktop") {
    // Headless Firefox on Ubuntu may not advance compressed-media playback
    // without a real audio device/codec path. The siren state and Web Audio
    // fallback are still exercised; payment-gate behavior has its own test.
    await expect(page.locator("#statusText")).toContainText("Alarm active");
    await expect(page.locator("#audioDiagnostic")).not.toContainText("not started");
  } else {
    await expect.poll(
      async () => page.locator("#alarmAudio").evaluate((audio) => audio.currentTime),
      { timeout: 5000 }
    ).toBeGreaterThan(0.05);
    const currentTime = await page.locator("#alarmAudio").evaluate((audio) => audio.currentTime);
    expect(currentTime).toBeGreaterThan(0.05);
    await expect(page.locator("#audioDiagnostic")).toContainText(/browser audio (?:is playing|is advancing)|accepted audio playback/i);
  }

  await page.getByRole("button", { name: /STOP ALARM/i }).click();
  await expect(page.getByRole("button", { name: /ACTIVATE SIREN/i })).toBeVisible();
  await expect(page.locator("#statusText")).toHaveText("Ready");
});

test("low-volume test starts without trusted-contact notification", async ({ page }) => {
  let notifyCalls = 0;
  await page.unroute("**/api/safety-notify**");
  await page.route("**/api/safety-notify**", async (route) => {
    notifyCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sent: 1, failed: 0 }),
    });
  });

  await page.goto("/");
  await page.locator("#notifyContacts").check();
  await page.getByRole("button", { name: /TEST AT LOW VOLUME/i }).click();
  await expect(page.locator("#statusText")).toContainText("Test active");
  await page.waitForTimeout(100);
  expect(notifyCalls).toBe(0);
});

test("locks the fourth activation and unlocks after verified PayPal capture", async ({ page }) => {
  await page.goto("/");

  for (let use = 1; use <= 3; use += 1) {
    await page.getByRole("button", { name: /ACTIVATE SIREN/i }).click();
    await expect(page.getByRole("button", { name: /STOP ALARM/i })).toBeVisible();
    await page.getByRole("button", { name: /STOP ALARM/i }).click();
  }

  await expect(page.locator("#freeUsesState")).toHaveText("3 / 3 used");

  await page.getByRole("button", { name: /ACTIVATE SIREN/i }).click();
  await expect(page.locator("#paywall")).toBeVisible();
  await expect(page.locator("#paywall")).toContainText("$5.00");
  await expect(page.locator("#statusText")).toContainText("Unlock required");

  await page.goto("/?paypal=return&token=ORDER-1");
  await expect(page.locator("#freeUsesState")).toHaveText("Unlimited");
  await expect(page.locator("#accessState")).toContainText("PayPal unlock confirmed");
  await expect(page.locator("#paywall")).toBeHidden();

  await page.getByRole("button", { name: /ACTIVATE SIREN/i }).click();
  await expect(page.getByRole("button", { name: /STOP ALARM/i })).toBeVisible();
});

test("location sharing requires opt-in and works with granted geolocation", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await context.setGeolocation({
    latitude: 42.3601,
    longitude: -71.0589,
    accuracy: 20,
  });

  await page.goto("/");
  await page.getByRole("button", { name: /SHARE CURRENT LOCATION/i }).click();
  await expect(page.locator("#locationState")).toHaveText("Turn on location sharing first.");

  await page.locator("#locationConsent").check();
  await page.getByRole("button", { name: /SHARE CURRENT LOCATION/i }).click();
  await expect(page.locator("#locationState")).toContainText("Location captured");
});

test("official alert lookup renders read-only official alert content", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /CHECK OFFICIAL ALERTS/i }).click();
  await expect(page.locator("#officialState")).toContainText("1 active");
  await expect(page.getByText("Test fixture child abduction alert")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open official alert/i })).toHaveAttribute(
    "href",
    "https://www.weather.gov/"
  );
});

test("service worker installs and the page reloads offline", async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "One dedicated Chromium service-worker run avoids duplicate cache tests and a Playwright WebKit headless offline-reload limitation."
  );

  const context = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    await page.goto("http://127.0.0.1:4173/");
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) {
        throw new Error("service worker unsupported");
      }
      await navigator.serviceWorker.ready;
    });

    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    }

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /ACTIVATE SIREN/i })).toBeVisible();
    await expect(page.locator("#connectionState")).toContainText("Offline");
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
  }
});
