// src/server.ts
// Singapore PayNow QR generator service.
// Vendored `sg-paynow-code` library (formerly a separate npm package) builds
// the EMVCo string; we render it to a PNG data URL with `qrcode`.

import 'dotenv/config';

import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import QRCode from 'qrcode';

import { generatePayNowCode } from './paynow';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 4000;
const DEFAULT_UEN = process.env.COMPANY_UEN; // optional fallback
const API_SECRET = process.env.PAYNOW_API_SECRET; // optional — if set, X-API-Key required

// --- Validation helpers ---------------------------------------------------

// UEN: 8-10 digits followed by a letter, e.g. 201912345C, R12345678A
const UEN_RE = /^[0-9]{8,10}[A-Z]$/;

// Singapore mobile: 8 digits starting with 8 or 9, optional +65 prefix
const MOBILE_RE = /^(?:\+?65)?[89]\d{7}$/;

// YYYYMMDD
const DATE_RE = /^\d{8}$/;

function bad(res: Response, message: string) {
    return res.status(400).json({ error: message });
}

// --- Auth middleware ------------------------------------------------------

// Module-level flag so the warning only fires once per process.
const apiKeyAuthWarned = { value: false };

function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
    if (!API_SECRET) {
        if (!apiKeyAuthWarned.value) {
            console.warn('[SECURITY] PAYNOW_API_SECRET is not set. API key check is DISABLED. Set it in .env before going to production.');
            apiKeyAuthWarned.value = true;
        }
        return next();
    }

    // Same-origin bypass: requests from the test page (served by this server
    // at public/test.html) don't need an API key. The browser sends Origin /
    // Referer headers automatically, so we can check that the request came
    // from our own host. Cross-origin requests (e.g. the WordPress plugin on
    // a different domain) still need the X-API-Key header.
    const host = req.get('Host') || '';
    const origin = req.get('Origin') || '';
    const referer = req.get('Referer') || '';
    let sameOrigin = false;
    try {
        if (origin) {
            sameOrigin = new URL(origin).host === host;
        } else if (referer) {
            sameOrigin = new URL(referer).host === host;
        }
    } catch (e) {
        sameOrigin = false;
    }
    if (sameOrigin) {
        return next();
    }

    // Cross-origin (or no Origin/Referer at all) requires the API key.
    const provided = req.get('X-API-Key');
    if (!provided || provided !== API_SECRET) {
        return res.status(401).json({ error: 'Invalid or missing API key.' });
    }
    next();
}

// --- Routes ---------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

// POST /api/generate-qr
// Body: { uen?, amount, reference?, recipientIdentifierType?, recipientIdentifier?, expiryDate? }
//   - For UEN flows: pass `uen` (or set COMPANY_UEN in .env as fallback).
//   - For mobile flows: pass `recipientIdentifierType: "MOBILE"` and
//     `recipientIdentifier: "+6591234567"`.
//   - `expiryDate`: optional, YYYYMMDD format.
//   - If PAYNOW_API_SECRET is set in env, `X-API-Key: <secret>` header is required.
app.post('/api/generate-qr', apiKeyAuth, async (req: Request, res: Response) => {
    try {
        const {
            uen,
            amount,
            reference = '',
            recipientIdentifierType,
            recipientIdentifier,
            expiryDate = '',
        } = (req.body || {}) as {
            uen?: string;
            amount?: unknown;
            reference?: string;
            recipientIdentifierType?: string;
            recipientIdentifier?: string;
            expiryDate?: string;
        };

        // Resolve recipient: either an explicit (type, id) pair, or default to UEN.
        let type: string | undefined = recipientIdentifierType;
        let id: string | undefined = recipientIdentifier;

        if (!type || !id) {
            const fallbackUEN = uen || DEFAULT_UEN;
            if (!fallbackUEN) {
                return bad(res, 'Recipient is required: provide uen, or set COMPANY_UEN, or pass recipientIdentifierType + recipientIdentifier.');
            }
            type = 'UEN';
            id = fallbackUEN;
        }

        type = String(type).toUpperCase();
        if (type !== 'UEN' && type !== 'MOBILE') {
            return bad(res, 'recipientIdentifierType must be "UEN" or "MOBILE".');
        }

        if (type === 'UEN' && !UEN_RE.test(id)) {
            return bad(res, 'Invalid UEN format. Expected 8-10 digits followed by a letter, e.g. 201912345C.');
        }
        if (type === 'MOBILE' && !MOBILE_RE.test(id)) {
            return bad(res, 'Invalid mobile format. Expected 8 digits (optionally prefixed with +65), e.g. +6591234567.');
        }

        // Amount: required, positive, up to 2 decimal places.
        const numericAmount = Number(amount);
        if (amount === undefined || amount === null || amount === '' || Number.isNaN(numericAmount)) {
            return bad(res, 'amount is required and must be a number.');
        }
        if (numericAmount <= 0) {
            return bad(res, 'amount must be greater than 0.');
        }
        if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(amount))) {
            return bad(res, 'amount must have at most 2 decimal places and 9 integer digits.');
        }

        // Optional expiry date (YYYYMMDD).
        let expiry = '';
        if (expiryDate) {
            if (!DATE_RE.test(String(expiryDate))) {
                return bad(res, 'expiryDate must be in YYYYMMDD format.');
            }
            expiry = String(expiryDate);
        }

        // Description: package requires it. Use a space if caller didn't provide one.
        const description = String(reference).trim() || ' ';

        // 1. Build the PayNow EMVCo string.
        const qrString = generatePayNowCode({
            paymentAmount: numericAmount,
            recipientIdentifierType: type as 'MOBILE' | 'UEN',
            recipientIdentifier: id,
            description,
            editable: false, // amount is fixed for dynamic QRs
            ...(expiry ? { expiryDate: expiry } : {}),
        });

        // 2. Render to a PNG data URL.
        const qrImageDataUrl = await QRCode.toDataURL(qrString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
        });

        res.json({
            qrImage: qrImageDataUrl,
            qrString, // also return the raw string — handy for testing/parsing
        });
    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

app.listen(PORT, () => {
    console.log(`PayNow QR service running on http://localhost:${PORT}`);
    console.log(`  Test page:  http://localhost:${PORT}/`);
    console.log(`  Health:     http://localhost:${PORT}/health`);
    console.log(`  Endpoint:   POST http://localhost:${PORT}/api/generate-qr`);
    if (API_SECRET) {
        console.log(`  Auth:       ENABLED — X-API-Key required for cross-origin requests`);
        console.log(`              (same-origin requests from the test page are bypassed)`);
    } else {
        console.log(`  Auth:       DISABLED (PAYNOW_API_SECRET not set)`);
    }
});
