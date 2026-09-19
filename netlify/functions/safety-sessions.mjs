import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const STORE = "activate-siren-safety-sessions";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CONTACTS = 3;
const ALLOWED_STATUS = new Set(["active", "resolved", "cancelled"]);

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

const safeBody = async (req) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const cleanText = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const sanitizeContacts = (value) => {
  if (!Array.isArray(value)) return null;

  const contacts = value.slice(0, MAX_CONTACTS).map((contact) => {
    const type = contact?.type === "email" ? "email" : "phone";
    return {
      id: cleanText(contact?.id, 80) || randomUUID(),
      name: cleanText(contact?.name, 60),
      type,
      value: cleanText(contact?.value, 160),
    };
  }).filter((contact) => contact.name && contact.value);

  return contacts;
};

const sanitizeLocation = (location) => {
  if (location === null) return null;
  if (!location || location.consent !== true) return undefined;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.min(accuracy, 100000)) : null,
    capturedAt: new Date().toISOString(),
    consent: true,
  };
};

const sessionView = (s) => ({
  id: s.id,
  status: s.status,
  alarmPattern: s.alarmPattern,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  expiresAt: s.expiresAt,
  resolvedAt: s.resolvedAt ?? null,
  location: s.location ?? null,
  trustedContacts: Array.isArray(s.trustedContacts) ? s.trustedContacts : [],
});

export default async (req) => {
  const store = getStore(STORE);
  const url = new URL(req.url);

  if (req.method === "POST") {
    const body = await safeBody(req);
    const now = Date.now();
    const requested = Number(body.ttlMs);
    const ttlMs = Number.isFinite(requested)
      ? Math.max(60_000, Math.min(requested, MAX_TTL_MS))
      : DEFAULT_TTL_MS;

    const id = randomUUID();
    const accessToken = randomBytes(32).toString("base64url");
    const session = {
      id,
      tokenHash: hashToken(accessToken),
      status: "active",
      alarmPattern: cleanText(body.alarmPattern, 32) || "siren",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      resolvedAt: null,
      location: null,
      trustedContacts: [],
    };

    await store.setJSON(id, session, {
      metadata: { expiration: now + ttlMs, status: "active" },
      onlyIfNew: true,
    });

    return json({ session: sessionView(session), accessToken }, 201);
  }

  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing session id" }, 400);

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

  if (req.method === "GET") {
    return json({ session: sessionView(session) });
  }

  if (req.method === "PATCH") {
    const body = await safeBody(req);
    let changed = false;
    const now = new Date().toISOString();

    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.has(body.status)) {
        return json({ error: "Invalid status" }, 400);
      }
      session.status = body.status;
      if (body.status !== "active") session.resolvedAt = now;
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, "location")) {
      const location = sanitizeLocation(body.location);
      if (location === undefined) {
        return json({ error: "Location requires explicit consent and valid coordinates" }, 400);
      }
      session.location = location;
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, "trustedContacts")) {
      const contacts = sanitizeContacts(body.trustedContacts);
      if (contacts === null) {
        return json({ error: "trustedContacts must be an array" }, 400);
      }
      session.trustedContacts = contacts;
      changed = true;
    }

    if (!changed) {
      return json({ error: "No supported fields supplied" }, 400);
    }

    session.updatedAt = now;

    await store.setJSON(id, session, {
      metadata: {
        expiration: expiration || Date.parse(session.expiresAt),
        status: session.status,
      },
    });

    return json({ session: sessionView(session) });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/safety-sessions",
};
