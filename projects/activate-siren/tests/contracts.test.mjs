import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const html = read("index.html");
const sessions = read("netlify/functions/safety-sessions.mjs");
const notify = read("netlify/functions/safety-notify.mjs");
const official = read("netlify/functions/official-alerts.mjs");
const cleanup = read("netlify/functions/cleanup-safety-sessions.mjs");
const health = read("netlify/functions/health.mjs");
const manifest = JSON.parse(read("manifest.webmanifest"));
const serviceWorker = read("sw.js");

test("browser script parses", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "inline application script must exist");
  assert.doesNotThrow(() => new vm.Script(match[1]));
});

test("core alarm controls remain present", () => {
  for (const id of [
    "activate",
    "stop",
    "test",
    "pattern",
    "volume",
    "flash",
    "vibrate",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /ACTIVATE SIREN/);
  assert.match(html, /TEST AT LOW VOLUME/);
});

test("low-volume tests cannot trigger trusted-contact delivery", () => {
  assert.match(
    html,
    /openSafetySession\(p,!low&&notifyContacts\.checked\)/,
    "notification flag must be false during low-volume tests"
  );
});

test("location sharing is explicit opt-in", () => {
  assert.match(html, /id="locationConsent"/);
  assert.match(sessions, /location\.consent !== true/);
  assert.match(sessions, /Location requires explicit consent/);
});

test("trusted contacts are capped and token protected", () => {
  assert.match(sessions, /const MAX_CONTACTS = 3/);
  assert.match(sessions, /tokenMatches\(readToken\(req\), session\.tokenHash\)/);
  assert.match(sessions, /trustedContacts/);
});

test("notification endpoint uses stored contacts instead of arbitrary recipients", () => {
  assert.match(notify, /session\.trustedContacts/);
  assert.match(notify, /session\.status !== "active"/);
  assert.match(notify, /MAX_ATTEMPTS_PER_SESSION = 3/);
  assert.doesNotMatch(
    notify,
    /body\.(to|recipient|phone|email)/,
    "notification recipients must not come from request body fields"
  );
});

test("notification providers are secret-driven", () => {
  for (const name of [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
  ]) {
    assert.match(notify, new RegExp(`process\\.env\\.${name}`));
  }
});

test("official alerts remain read-only and filter non-actual messages", () => {
  assert.match(official, /req\.method !== "GET"/);
  assert.match(official, /Child Abduction Emergency/);
  assert.match(official, /String\(alert\.status\)\.toLowerCase\(\) === "actual"/);
  assert.match(official, /\["test", "exercise"\]/);
});

test("expired safety-session data has a deletion path", () => {
  assert.match(cleanup, /schedule: "@hourly"/);
  assert.match(cleanup, /store\.delete\(blob\.key\)/);
});

test("safety notices remain visible", () => {
  assert.match(html, /does not contact emergency services/i);
  assert.match(html, /cannot create, issue, modify, or cancel an AMBER Alert/i);
});


test("offline shell is registered without caching emergency APIs", () => {
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /serviceWorker\.register\('\.\/sw\.js'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /caches\.match\("\.\/index\.html"\)/);
});

test("web app manifest supports standalone installation", () => {
  assert.equal(manifest.name, "Activate Siren");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  assert.equal(manifest.icons[0].type, "image/svg+xml");
  assert.equal(manifest.icons[0].sizes, "any");
});

test("offline support never changes the local-alarm independence rule", () => {
  assert.match(html, /Offline • local siren ready/);
  assert.match(html, /does not contact emergency services/i);
});


test("deployment health endpoint exposes readiness without secrets", () => {
  assert.match(health, /path: "\/api\/health"/);
  assert.match(health, /emailConfigured/);
  assert.match(health, /smsConfigured/);
  assert.match(health, /process\.env\.RESEND_API_KEY/);
  assert.match(health, /process\.env\.TWILIO_ACCOUNT_SID/);
  assert.doesNotMatch(health, /apiKey\s*:\s*process\.env/);
  assert.doesNotMatch(health, /authToken\s*:\s*process\.env/);
});


test("real WAV alarm media is the primary playback path", () => {
  assert.match(html, /id="alarmAudio"/);
  assert.match(html, /src="\.\/audio\/siren\.wav"/);
  assert.match(html, /alarmAudio\.play\(\)/);
  assert.match(html, /startWebAudioFallback/);
  for (const file of ["siren.wav", "high.wav", "pulse.wav", "sos.wav"]) {
    assert.match(serviceWorker, new RegExp("audio/" + file.replace(".", "\\.")));
  }
});
