import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const ACCESS_STORE = "activate-siren-access";
export const FREE_USE_LIMIT = 3;

export const accessStore = () => getStore(ACCESS_STORE);

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");

const safeEqualHex = (a, b) => {
  try {
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
};

export const isCreatorId = (visitorId) =>
  Boolean(
    visitorId &&
    process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID &&
    visitorId === process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID
  );

export const visitorView = (record) => {
  const creator = isCreatorId(record.id);
  const unlimited = creator || record.unlimited === true;
  const freeUses = Math.max(0, Number(record.freeUses || 0));
  return {
    visitorId: record.id,
    freeUses,
    freeUseLimit: FREE_USE_LIMIT,
    remainingFreeUses: unlimited ? null : Math.max(0, FREE_USE_LIMIT - freeUses),
    creator,
    unlimited,
    paid: record.unlimited === true,
    locked: !unlimited && freeUses >= FREE_USE_LIMIT,
    unlockedAt: record.unlockedAt || null,
  };
};

export async function createVisitor() {
  const store = accessStore();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const record = {
      id,
      tokenHash: sha256(secret),
      freeUses: 0,
      unlimited: false,
      createdAt: now,
      updatedAt: now,
      unlockedAt: null,
      paypalCaptureId: null,
      paypalOrderId: null,
    };

    const result = await store.setJSON(`visitor:${id}`, record, {
      onlyIfNew: true,
    });

    if (result.modified) {
      return {
        accessToken: `${id}.${secret}`,
        record,
      };
    }
  }

  throw new Error("Could not create access identity");
}

export const bearerToken = (req) => {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

export async function authenticateVisitor(req) {
  const token = bearerToken(req);
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!id || !secret) return null;

  const store = accessStore();
  const entry = await store.getWithMetadata(`visitor:${id}`, {
    type: "json",
    consistency: "strong",
  });

  if (!entry?.data?.tokenHash) return null;
  if (!safeEqualHex(sha256(secret), entry.data.tokenHash)) return null;

  return {
    id,
    secret,
    record: entry.data,
    etag: entry.etag,
  };
}

export async function consumeFreeUse(req) {
  const auth = await authenticateVisitor(req);
  if (!auth) return { error: "unauthorized" };

  const store = accessStore();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const entry = await store.getWithMetadata(`visitor:${auth.id}`, {
      type: "json",
      consistency: "strong",
    });

    if (!entry?.data?.tokenHash) return { error: "unauthorized" };
    if (!safeEqualHex(sha256(auth.secret), entry.data.tokenHash)) {
      return { error: "unauthorized" };
    }

    const current = entry.data;
    const view = visitorView(current);

    if (view.unlimited) {
      return { allowed: true, record: current, view, counted: false };
    }

    if (view.locked) {
      return { allowed: false, record: current, view, counted: false };
    }

    const next = {
      ...current,
      freeUses: view.freeUses + 1,
      updatedAt: new Date().toISOString(),
    };

    const result = await store.setJSON(`visitor:${auth.id}`, next, {
      onlyIfMatch: entry.etag,
    });

    if (result.modified) {
      return {
        allowed: true,
        record: next,
        view: visitorView(next),
        counted: true,
      };
    }
  }

  return { error: "conflict" };
}

export async function unlockVisitor(visitorId, details = {}) {
  const store = accessStore();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const entry = await store.getWithMetadata(`visitor:${visitorId}`, {
      type: "json",
      consistency: "strong",
    });
    if (!entry?.data) return { error: "visitor_not_found" };

    if (entry.data.unlimited === true) {
      return { record: entry.data, view: visitorView(entry.data), alreadyUnlocked: true };
    }

    const now = new Date().toISOString();
    const next = {
      ...entry.data,
      unlimited: true,
      unlockedAt: now,
      updatedAt: now,
      paypalCaptureId: details.captureId || entry.data.paypalCaptureId || null,
      paypalOrderId: details.orderId || entry.data.paypalOrderId || null,
    };

    const result = await store.setJSON(`visitor:${visitorId}`, next, {
      onlyIfMatch: entry.etag,
    });

    if (result.modified) {
      return { record: next, view: visitorView(next), alreadyUnlocked: false };
    }
  }

  return { error: "conflict" };
}

export function paypalConfig() {
  const environment = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  const baseUrl =
    environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const price = String(process.env.SIREN_UNLOCK_PRICE || "5.00").trim();
  const currency = String(process.env.SIREN_UNLOCK_CURRENCY || "USD")
    .trim()
    .toUpperCase();

  const priceValid = /^(?:0|[1-9]\d*)(?:\.\d{2})$/.test(price) && Number(price) > 0;
  const currencyValid = /^[A-Z]{3}$/.test(currency);

  const missing = [];
  if (!process.env.PAYPAL_CLIENT_ID) missing.push("PAYPAL_CLIENT_ID");
  if (!process.env.PAYPAL_CLIENT_SECRET) missing.push("PAYPAL_CLIENT_SECRET");
  if (!priceValid) missing.push("SIREN_UNLOCK_PRICE");
  if (!currencyValid) missing.push("SIREN_UNLOCK_CURRENCY");

  return {
    environment,
    baseUrl,
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID || "",
    price,
    currency,
    configured: missing.length === 0,
    missing,
  };
}

export async function paypalAccessToken(config = paypalConfig()) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("PayPal credentials are not configured");
  }

  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8"
  ).toString("base64");

  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "PayPal authentication failed");
  }

  return data.access_token;
}

export function completedCapture(order) {
  const purchaseUnits = Array.isArray(order?.purchase_units)
    ? order.purchase_units
    : [];

  for (const unit of purchaseUnits) {
    const captures = Array.isArray(unit?.payments?.captures)
      ? unit.payments.captures
      : [];

    for (const capture of captures) {
      if (capture?.status === "COMPLETED") {
        return { capture, unit };
      }
    }
  }

  return null;
}

export function amountMatches(amount, expectedValue, expectedCurrency) {
  return Boolean(
    amount &&
    String(amount.value) === String(expectedValue) &&
    String(amount.currency_code || "").toUpperCase() ===
      String(expectedCurrency || "").toUpperCase()
  );
}

export async function recordCaptureOnce({
  captureId,
  visitorId,
  orderId,
  amount,
  currency,
}) {
  const store = accessStore();
  const key = `capture:${captureId}`;
  const payload = {
    captureId,
    visitorId,
    orderId,
    amount,
    currency,
    recordedAt: new Date().toISOString(),
  };

  const result = await store.setJSON(key, payload, { onlyIfNew: true });
  if (result.modified) return { ok: true, duplicate: false, payload };

  const existing = await store.get(key, {
    type: "json",
    consistency: "strong",
  });

  if (
    existing?.visitorId === visitorId &&
    existing?.orderId === orderId
  ) {
    return { ok: true, duplicate: true, payload: existing };
  }

  return { ok: false, error: "capture_already_used" };
}
