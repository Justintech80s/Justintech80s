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

The siren audio and screen-flash effects run locally in the browser. The low-volume test remains local. Real siren activations now require an online access check so the three-use payment gate can be enforced consistently; if that access check is unavailable, a metered real activation does not start.


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


## Three-use siren gate and PayPal unlock

The backend now supports three free siren activations per server-issued access identity, followed by a PayPal unlock for unlimited access.

### Access identity

`POST /api/siren-access`

Bootstrap an anonymous access identity:

```json
{
  "action": "bootstrap"
}
```

The response includes a random bearer `accessToken` and an access snapshot. The token must be retained by the client and sent in:

`Authorization: Bearer <accessToken>`

The token secret is stored only as a SHA-256 hash on the backend.

### Check access

`GET /api/siren-access`

Requires the bearer token and returns:

- number of free uses consumed
- remaining free uses
- whether the identity is locked
- whether the identity has unlimited access
- whether the identity is configured as the creator

### Consume a siren activation

`POST /api/siren-access`

```json
{
  "action": "consume"
}
```

Behavior:

1. Uses 1 through 3 return `allowed: true`.
2. The third use is allowed and leaves zero free uses remaining.
3. The fourth and later unpaid attempts return HTTP `402` with `paymentRequired: true`.
4. Paid or creator identities are allowed without incrementing the free-use count.

The free-use counter uses Netlify Blobs ETags and `onlyIfMatch` conditional writes so concurrent activation requests cannot reuse the same counter state.

### Creator bypass

The creator is exempt from the free-use limit when the server-issued visitor ID matches:

`ACTIVATE_SIREN_CREATOR_VISITOR_ID`

This value belongs in the deployment environment, never in browser JavaScript.

### Create PayPal unlock order

`POST /api/paypal/create-order`

Requires the bearer token.

An order can only be created after all three free activations have been consumed. The backend price defaults to $5.00 USD and is verified again at capture/webhook time.

The endpoint returns:

- PayPal order ID
- PayPal approval URL
- configured amount and currency

### Capture and unlock

`POST /api/paypal/capture-order`

Body:

```json
{
  "orderId": "PAYPAL_ORDER_ID"
}
```

Requires the same bearer token that created the order.

Unlimited access is granted only after the backend verifies:

- the PayPal order belongs to the same access identity
- the capture status is exactly `COMPLETED`
- capture amount exactly matches the stored order amount
- capture currency exactly matches the stored order currency
- the PayPal capture ID has not already been used for another identity

A `PENDING`, `FAILED`, `DECLINED`, or otherwise incomplete capture does not unlock the siren.

### PayPal webhook

`POST /api/paypal/webhook`

The webhook verifies PayPal's signature through PayPal's webhook verification endpoint before processing the event.

Only `PAYMENT.CAPTURE.COMPLETED` events can grant access. The webhook rechecks the stored order, amount, currency, and unique capture ID before applying the unlimited entitlement.

Configure the PayPal app to send `PAYMENT.CAPTURE.COMPLETED` to this HTTPS endpoint.

### Required environment variables

```text
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

SIREN_UNLOCK_PRICE=5.00
SIREN_UNLOCK_CURRENCY=USD

ACTIVATE_SIREN_CREATOR_VISITOR_ID=
```

Use `PAYPAL_ENV=sandbox` until the entire checkout flow has been tested. Set `PAYPAL_ENV=live` only when the production PayPal app is ready.

The unlock price defaults to **$5.00 USD** in the backend. `SIREN_UNLOCK_PRICE` remains available as a server-side override, but the intended production price is `5.00` and the website displays that same amount.

### Identity limitation

This implementation uses a random server-issued browser identity rather than a required user account. That prevents a normal browser from changing a local `paid=true` flag to unlock itself, and all counters and entitlements live on the backend.

However, an anonymous browser identity is not the same as a verified human account. A person who intentionally clears the access token or switches browsers/devices can obtain a new identity. Strong one-person enforcement would require account authentication (for example, email/passkey login) before the three-use counter is considered fully tamper-resistant across devices.


### Browser compatibility

The payment gate uses standards-based `fetch`, `localStorage` with `sessionStorage` fallback, normal HTTPS redirects, and server-side bearer tokens. Automated browser coverage runs against Chromium (Chrome/Edge engine), WebKit (Safari engine), and Firefox.

The client silently primes the alarm media element during the original activation tap before awaiting the server access decision. This preserves Safari/iPhone user-gesture audio requirements while keeping the fourth unpaid activation inaudible and locked.

The PayPal return flow preserves the server-issued access token in browser storage, captures the PayPal order on return, verifies the completed capture server-side, and refreshes the unlimited entitlement before the siren can be used again.
