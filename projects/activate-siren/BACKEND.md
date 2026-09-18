# Activate Siren Safety Session Backend

This is the first backend milestone for Activate Siren.

## Endpoint

`/api/safety-sessions`

### Create
`POST /api/safety-sessions`

Returns a random session ID and a one-time bearer token.

### Read
`GET /api/safety-sessions?id=<id>`

Requires:

`Authorization: Bearer <token>`

### Update
`PATCH /api/safety-sessions?id=<id>`

Requires the same bearer token. Accepted states:

- `active`
- `resolved`
- `cancelled`

## Privacy

The initial implementation stores no name, account, phone number, or location. Sessions expire automatically. Location sharing will only be added behind an explicit user-consent flow.

## Reliability

The emergency siren remains local to the browser. A backend outage must never prevent the alarm from sounding.
