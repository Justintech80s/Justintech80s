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

Contacts are session-scoped. Automatic SMS or email delivery is not part of this milestone and is not implied by storing a trusted contact.

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
