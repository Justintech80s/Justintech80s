import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const STORE = "activate-siren-safety-sessions";
const MAX_ATTEMPTS_PER_SESSION = 3;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const hashToken = (token) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const tokenMatches = (provided, expectedHash) => {
  if (!provided || !expectedHash) return false;
  const actual = Buffer.from(hashToken(provided), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const readToken = (req) => {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

const validEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const validPhone = (value) =>
  /^\+[1-9]\d{7,14}$/.test(String(value || "").trim());

const locationLink = (location) => {
  if (!location?.consent) return "";
  if (!Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(location.latitude + "," + location.longitude)}`;
};

const buildMessage = (session) => {
  const when = new Date(session.createdAt || Date.now()).toUTCString();
  const map = locationLink(session.location);
  const locationText = map ? ` Shared location: ${map}` : "";
  return `Activate Siren personal safety alert: someone who listed you as a trusted contact activated their alarm at ${when}. This is not an emergency-services dispatch. If appropriate, check on them.${locationText}`;
};

const sendEmail = async ({ to, message, idempotencyKey }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { status: "not_configured", provider: "resend" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Activate Siren trusted-contact alert",
      text: message,
    }),
  });

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    return {
      status: "failed",
      provider: "resend",
      code: response.status,
      error: data?.message || data?.name || "Email provider rejected the request",
    };
  }

  return {
    status: "sent",
    provider: "resend",
    providerMessageId: data?.id || null,
  };
};

const sendSms = async ({ to, message }) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return { status: "not_configured", provider: "twilio" };
  }

  const body = new URLSearchParams({ To: to, From: from, Body: message });
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    return {
      status: "failed",
      provider: "twilio",
      code: response.status,
      error: data?.message || "SMS provider rejected the request",
    };
  }

  return {
    status: "sent",
    provider: "twilio",
    providerMessageId: data?.sid || null,
  };
};

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing session id" }, 400);

  const store = getStore(STORE);
  const entry = await store.getWithMetadata(id, {
    type: "json",
    consistency: "strong",
  });

  if (!entry) return json({ error: "Session not found" }, 404);

  const expiration = Number(entry.metadata?.expiration || 0);
  if (expiration && expiration <= Date.now()) {
    await store.delete(id);
    return json({ error: "Session expired" }, 410);
  }

  const session = entry.data;
  if (!tokenMatches(readToken(req), session.tokenHash)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (session.status !== "active") {
    return json({ error: "Notifications can only be sent for an active Safety Session" }, 409);
  }

  const contacts = Array.isArray(session.trustedContacts)
    ? session.trustedContacts.slice(0, 3)
    : [];

  if (!contacts.length) {
    return json({ error: "No trusted contacts are attached to this Safety Session" }, 400);
  }

  const existing = session.notificationDelivery || {
    attempts: 0,
    contacts: {},
    updatedAt: null,
  };

  if (existing.attempts >= MAX_ATTEMPTS_PER_SESSION) {
    return json({
      error: "Notification attempt limit reached",
      delivery: existing,
    }, 429);
  }

  const deliverable = contacts.filter((contact) => {
    if (contact.type === "email") {
      return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
    }
    if (contact.type === "phone") {
      return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER
      );
    }
    return false;
  });

  if (!deliverable.length) {
    return json({
      error: "Notification providers are not configured",
      requiredEnvironmentVariables: {
        email: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
        sms: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
      },
    }, 503);
  }

  existing.attempts += 1;
  existing.updatedAt = new Date().toISOString();
  session.notificationDelivery = existing;
  session.updatedAt = existing.updatedAt;

  await store.setJSON(id, session, {
    metadata: {
      expiration: expiration || Date.parse(session.expiresAt),
      status: session.status,
    },
  });

  const message = buildMessage(session);
  const results = [];

  for (const contact of contacts) {
    const prior = existing.contacts?.[contact.id];
    if (prior?.status === "sent") {
      results.push({ id: contact.id, name: contact.name, type: contact.type, ...prior });
      continue;
    }

    let result;

    if (contact.type === "email") {
      if (!validEmail(contact.value)) {
        result = { status: "invalid", provider: "resend", error: "Invalid email address" };
      } else {
        result = await sendEmail({
          to: contact.value,
          message,
          idempotencyKey: `activate-siren/${session.id}/${contact.id}`,
        });
      }
    } else if (contact.type === "phone") {
      if (!validPhone(contact.value)) {
        result = {
          status: "invalid",
          provider: "twilio",
          error: "Phone number must use international E.164 format, such as +15551234567",
        };
      } else {
        const lockKey = `notify-lock:${session.id}:${contact.id}`;
        const lock = await store.getWithMetadata(lockKey, {
          type: "json",
          consistency: "strong",
        });

        if (lock?.data?.status === "sent" || lock?.data?.status === "sending") {
          result = {
            status: lock.data.status === "sent" ? "sent" : "in_progress",
            provider: "twilio",
            providerMessageId: lock.data.providerMessageId || null,
          };
        } else {
          const lockValue = {
            status: "sending",
            createdAt: new Date().toISOString(),
          };

          await store.setJSON(lockKey, lockValue, {
            metadata: {
              expiration: expiration || Date.parse(session.expiresAt),
              kind: "notification-lock",
            },
          });

          result = await sendSms({ to: contact.value, message });

          await store.setJSON(lockKey, {
            ...result,
            updatedAt: new Date().toISOString(),
          }, {
            metadata: {
              expiration: expiration || Date.parse(session.expiresAt),
              kind: "notification-lock",
            },
          });
        }
      }
    } else {
      result = { status: "invalid", provider: "none", error: "Unsupported contact type" };
    }

    existing.contacts[contact.id] = {
      status: result.status,
      provider: result.provider,
      providerMessageId: result.providerMessageId || null,
      error: result.error || null,
      updatedAt: new Date().toISOString(),
    };

    results.push({
      id: contact.id,
      name: contact.name,
      type: contact.type,
      ...existing.contacts[contact.id],
    });
  }

  session.notificationDelivery = existing;
  session.updatedAt = new Date().toISOString();

  await store.setJSON(id, session, {
    metadata: {
      expiration: expiration || Date.parse(session.expiresAt),
      status: session.status,
    },
  });

  return json({
    sessionId: session.id,
    results,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed" || r.status === "invalid").length,
  });
};

export const config = {
  path: "/api/safety-notify",
};
