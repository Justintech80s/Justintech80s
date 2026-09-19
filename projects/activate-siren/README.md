# Activate Siren

Free, browser-based emergency attention alarm.

**Live Website:** https://cozy-crumble-3bd29b.netlify.app/

## Features
- One-tap siren
- Native media alarm playback with AAC/M4A first on iPhone, MP3 fallback, WAV fallback, and Web Audio fallback
- Emergency Siren, High-Pitch, Pulse, and SOS patterns
- Adjustable volume
- Low-volume test mode
- Optional screen flash
- Optional vibration on supported devices
- Installable/offline-capable web app shell after the first successful load
- No login required for the local siren
- Optional short-lived Safety Sessions for consented location and trusted-contact workflows

## Offline behavior
The local siren interface, Web Audio alarm logic, manifest, and app icon are cached by a service worker after a successful visit. Safety Session APIs, trusted-contact notifications, and official public-safety alerts are deliberately network-only and are never served from the offline cache.

## Safety
This tool is designed to attract attention. It does not contact police, fire, EMS, 911, or other emergency services. Browsers cannot override a device's hardware volume or silent-mode restrictions.

## Hosting
The same source is prepared for GitHub Pages and Netlify.

### Netlify
Import the GitHub repository and use:
- Base directory: `projects/activate-siren`
- Build command: leave blank
- Publish directory: `.`

[Deploy this project to Netlify](https://app.netlify.com/start/deploy?repository=https://github.com/Justintech80s/Justintech80s&create_from_path=projects/activate-siren)


## Browser verification
Automated browser smoke tests run in GitHub Actions with pinned Playwright 1.63.0 against Chromium desktop, Chromium mobile-size, and WebKit mobile-size contexts. They verify:

- siren start/stop UI flow
- low-volume tests never send trusted-contact notifications
- explicit geolocation opt-in behavior
- official-alert rendering
- service-worker installation and offline reload

Headless browser testing verifies application behavior but cannot prove physical speaker loudness, device mute-switch behavior, or vibration hardware. Those remain physical-device checks.


## Audio compatibility
The production alarm now uses pre-generated WAV media files as the primary playback path. Playback is started directly from the user's button tap, which is more compatible with mobile Safari and mobile Chromium than relying only on an oscillator-based AudioContext. The original Web Audio generator remains as a fallback if the media element is rejected.


## iPhone audio hardening
The iPhone-focused audio revision uses cache-busted, standard 44.1 kHz 16-bit mono PCM WAV assets. The service-worker cache generation was advanced so previously cached low-rate alarm files are discarded. The UI also disables the vibration option when the browser does not expose the Vibration API.


## iPhone web limitations
The iPhone path now prefers AAC/M4A, then MP3, then WAV, all initiated directly from the user tap. The interface reports whether the browser's media playback clock actually advances. If playback advances but no sound is audible, the remaining issue is outside page-level playback logic (for example Silent Mode, an embedded WKWebView, media-volume level, Bluetooth, or AirPlay routing).

A normal website cannot force iPhone vibration because iOS WebKit does not expose the Vibration API. On iPhone the vibration control is therefore disabled rather than shown as functional.
