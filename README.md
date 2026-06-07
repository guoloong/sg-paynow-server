# sg-paynow-server

Minimal Express service that generates **Singapore PayNow** QR codes and
serves a small HTML test page for trying it out in the browser.

The PayNow EMVCo string builder is **bundled in** — the project used to depend
on a separate [`sg-paynow-code`](https://www.npmjs.com/package/sg-paynow-code)
npm package; that source is now vendored under `src/paynow/` and imported
directly. As of v2.0.0 the server is written in TypeScript and compiled with
`tsc` at build time.

## Quick start

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
# edit .env — at minimum, set PAYNOW_API_SECRET (see below)

# 3. build (TypeScript → dist/)
npm run build

# 4. run
npm start
```

For local development with auto-reload (no build step, runs TS directly via
[`tsx`](https://github.com/privatenumber/tsx)):

```bash
npm run dev
```

Then open:

- **http://localhost:4000/** — test page (form)
- **POST http://localhost:4000/api/generate-qr** — JSON API (requires `X-API-Key` header if secret is set)
- **GET http://localhost:4000/health** — liveness check

## API

### `POST /api/generate-qr`

**UEN flow** (most common — pay a company by its Unique Entity Number):

```json
{
  "uen": "201912345C",
  "amount": "10.00",
  "reference": "INV-001"
}
```

**Mobile flow** (pay an individual by mobile number):

```json
{
  "recipientIdentifierType": "MOBILE",
  "recipientIdentifier": "+6591234567",
  "amount": "10.00",
  "reference": "INV-001"
}
```

If `uen` is omitted and `COMPANY_UEN` is set in `.env`, the env value is used
as a fallback. If neither is set, you must explicitly pass the recipient.

**Response:**

```json
{
  "qrImage": "data:image/png;base64,iVBORw0KGgo...",
  "qrString": "00020101021126370009SG.PAYNOW..."
}
```

`qrImage` is a PNG data URL — drop it straight into an `<img src="...">`.
`qrString` is the raw EMVCo string (useful for debugging / saving alongside).

### Validation

The server returns `400` with a clear error message for:

- Missing or malformed UEN (`/^[0-9]{8,10}[A-Z]$/`)
- Missing or malformed mobile (`/^(?:\+?65)?[89]\d{7}$/`)
- Non-numeric, zero, or negative amount
- Amount with more than 2 decimal places or more than 9 integer digits
- Recipient type other than `UEN` or `MOBILE`

## Files

```
sg-paynow-server/
├── src/
│   ├── server.ts                # Express server
│   └── paynow/                  # Vendored PayNow EMVCo string builder
│       ├── index.ts
│       ├── generatePayNowCode.ts
│       ├── generatePayNowCode.test.ts
│       ├── strWithOptions.ts
│       ├── crc16CheckSum.ts
│       └── padLeft.ts
├── public/
│   └── test.html                # browser test page (served at /)
├── dist/                        # tsc output (gitignored)
├── .env.example                 # copy to .env
├── .gitignore
├── package.json
├── tsconfig.json
├── LICENSE                      # MIT
└── README.md
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile `src/` to `dist/` with `tsc` |
| `npm start` | Run the compiled server (`node dist/server.js`) |
| `npm run dev` | Run the server in watch mode via `tsx` (no build needed) |
| `npm test` | Run the unit tests for the PayNow string builder via `node:test` |

## Notes

- `description` (the `reference` from the request) is mapped to the EMVCo
  "Bill Number" sub-field (ID 62.01). It shows up on the recipient's
  bank statement.
- `editable: false` is hardcoded — the amount in the QR is fixed, the
  payer can't change it in-app.
- For production: add rate limiting and a reverse proxy (nginx / Caddy) with HTTPS.
- The WP plugin (and any other client) must be configured with the same `PAYNOW_API_SECRET` value.

## API authentication

The `/api/generate-qr` endpoint can be protected with a shared secret.

**Generate a secret:**

```bash
openssl rand -hex 32
# e.g. a1b2c3d4e5f6...
```

**Set it on the server** by putting it in `.env`:

```
PAYNOW_API_SECRET=a1b2c3d4e5f6...
```

**Pass it on every request** as a header:

```bash
curl -X POST http://localhost:4000/api/generate-qr \
  -H "Content-Type: application/json" \
  -H "X-API-Key: a1b2c3d4e5f6..." \
  -d '{"uen":"201912345C","amount":"10.00","reference":"INV-001"}'
```

If `PAYNOW_API_SECRET` is **not set** in `.env`, the server logs a startup
warning and accepts all requests — fine for local dev, **not safe for public
deployment**. The companion WordPress plugin reads the same value from its
`API Key` setting.

### Same-origin bypass

Requests originating from the **test page** served by this server (i.e. a
browser navigating to `https://<your-host>/test.html` and clicking the
button) are exempted from the API-key check. The browser sends `Origin` /
`Referer` headers automatically, and the middleware checks that those point
back to the same host.

This means:

| Client | Origin header | API key needed? |
|--------|---------------|-----------------|
| Browser on the test page (`https://<host>/test.html`) | same host | **No** (bypass) |
| WordPress plugin on `https://www.dyna-nutrition.com` | different host | **Yes** |
| `curl` / `Postman` / server-to-server | none | **Yes** |

If you want to lock the test page down too (e.g. behind a basic-auth or VPN),
you can: just add the `X-API-Key` header in the test page's `fetch()` call
or remove the `sameOrigin` branch in the middleware.

## Migrating from v1.x

The runtime API is unchanged. The two breaking changes are packaging:

1. `server.js` is no longer at the repo root — it's compiled to `dist/server.js`. Run `npm run build` before `npm start`, or use `npm run dev` (no build needed).
2. The `sg-paynow-code` dependency is gone. Its source is vendored under `src/paynow/`. The `generatePayNowCode` function behaves identically.
