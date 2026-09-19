# Activate Siren Safety Session Backend

Activate Siren keeps the emergency alarm local to the browser while using a short-lived backend Safety Session for optional safety data.

## Endpoint

`/api/safety-sessions`

### Create

`POST /api/safety-sessions`

Creates an anonymous, short-lived Safety Session and returns:

- random session ID
- one-time bearer access token
- expiration timestamp

No account is required.

### Read

`GET /api/safety-sessions?id=<id>`

Requires:

`Authorization: Bearer <token>`

The token-protected response can include session status, consented location, and session-scoped trusted contacts.

### Update

`PATCH /api/safety-sessions?id=<id>`

Requires the same bearer token.

Supported fields:

#### Status

- `active`
- `resolved`
- `cancelled`

#### Location

Location is accepted only when the request contains explicit consent:

```json
{
  "location": {
    "consent": true,
    "latitude": 42.0,
    "longitude": -71.0,
    "accuracy": 25
  }
}
```

Sending `"location": null` removes a previously shared location.

The browser permission prompt is still required. Location sharing is off by default.

#### Trusted contacts

Up to three contacts can be attached to the active Safety Session:

```json
{
  "trustedContacts": [
    {
      "id": "random-id",
      "name": "Trusted person",
      "type": "phone",
      "value": "contact destination"
    }
  ]
}
```

Contacts are session-scoped.

## Trusted-contact notification delivery

`POST /api/safety-notify?id=<session-id>`

Requires the Safety Session bearer token.

The endpoint never accepts arbitrary recipients. It reads the already-authenticated `trustedContacts` stored on the active Safety Session and attempts delivery only to those contacts.

Delivery behavior:

- Email contacts use Resend.
- Phone contacts use Twilio SMS.
- Notification delivery is opt-in in the browser.
- Low-volume alarm tests never send trusted-contact notifications.
- A Safety Session must still be active.
- Repeated email requests use a stable Resend idempotency key.
- SMS delivery uses a per-contact session lock to reduce duplicate sends.
- A network failure with an uncertain SMS outcome is not retried automatically.
- Each session allows a maximum of three delivery attempts.

If consented location was already attached to the Safety Session before notification delivery, the trusted-contact message can include a maps link. No location is included unless the session contains explicitly consented location data.

### Netlify environment variables

Set these as Netlify site environment variables, not in GitHub and not in `netlify.toml`.

For email delivery:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

For SMS delivery:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

A site can configure email only, SMS only, or both. The notification endpoint reports `503` when none of the providers required by the attached contacts are configured.

`RESEND_FROM_EMAIL` must be a sender Resend allows the account to use. `TWILIO_FROM_NUMBER` must be a Twilio-capable sender/number appropriate for the destination and applicable carrier requirements.

## Privacy and retention

- No account is required.
- Location is never requested unless the user enables sharing.
- Location is rejected by the API unless `consent: true` is present.
- Trusted contacts are capped at three.
- Safety Sessions become inaccessible after their expiration timestamp.
- An hourly scheduled cleanup function physically deletes expired Safety Session blobs, including any location and trusted-contact data.
- Browser contact preferences are stored only in `sessionStorage`, not permanent local storage.
- The bearer token is required to read or modify the server-side session.

## Reliability

The siren, flash, and vibration features remain local to the browser. Failure of the backend, location service, or contact synchronization must not prevent the siren from sounding.


## Official public-safety alerts

`GET /api/official-alerts`

This is a read-only redistribution layer for active government alerts.

Query parameters:

- `mode=amber` — returns active `Child Abduction Emergency` alerts only.
- `mode=all` — returns a curated set of active non-weather public-safety events.
- `area=MA` — optional two-letter state or territory filter.

The current live source is the National Weather Service Alerts API using CAP-compatible alert data.

Important boundaries:

- Only alerts with status `Actual` are returned.
- Test and exercise messages are filtered out.
- Expired messages are filtered out.
- Activate Siren cannot originate, edit, cancel, or impersonate an official alert.
- The public FEMA IPAWS archive is not used as the live source because it is intentionally delayed.
- This first integration should not be treated as a guarantee that every AMBER Alert issued anywhere in the United States will appear in this feed; the UI identifies the government source for the alerts it does receive.

The backend sends a distinct User-Agent to the NWS API and caches successful responses briefly to reduce unnecessary load.
