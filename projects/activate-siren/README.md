# Activate Siren

Free, browser-based emergency attention alarm.

## Features
- One-tap siren
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
