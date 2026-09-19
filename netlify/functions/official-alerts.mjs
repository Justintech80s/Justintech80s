const NWS_BASE = "https://api.weather.gov/alerts/active";
const USER_AGENT = "ActivateSiren/1.0 (https://github.com/Justintech80s/Justintech80s)";

const PUBLIC_SAFETY_EVENTS = new Set([
  "Child Abduction Emergency",
  "Blue Alert",
  "Civil Danger Warning",
  "Civil Emergency Message",
  "Evacuation Immediate",
  "Fire Warning",
  "Hazardous Materials Warning",
  "Law Enforcement Warning",
  "Local Area Emergency",
  "911 Telephone Outage Emergency",
  "Nuclear Power Plant Warning",
  "Radiological Hazard Warning",
  "Shelter in Place Warning",
]);

const json = (body, status = 200, maxAge = 60) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200
        ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=120`
        : "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const cleanArea = (value) => {
  const area = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(area) ? area : "";
};

const normalize = (feature) => {
  const p = feature?.properties || {};
  return {
    id: feature?.id || p.id || null,
    source: "National Weather Service / CAP",
    event: p.event || "Public Safety Alert",
    headline: p.headline || "",
    description: p.description || "",
    instruction: p.instruction || "",
    area: p.areaDesc || "",
    severity: p.severity || "Unknown",
    urgency: p.urgency || "Unknown",
    certainty: p.certainty || "Unknown",
    sent: p.sent || null,
    effective: p.effective || null,
    onset: p.onset || null,
    expires: p.expires || null,
    senderName: p.senderName || "",
    status: p.status || "",
    messageType: p.messageType || "",
    officialUrl: feature?.id || null,
  };
};

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, 0);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "all" ? "all" : "amber";
  const rawArea = url.searchParams.get("area");
  const area = cleanArea(rawArea);

  if (rawArea && !area) {
    return json({ error: "area must be a two-letter U.S. state or territory code" }, 400, 0);
  }

  const upstream = new URL(NWS_BASE);
  if (area) upstream.searchParams.set("area", area);

  let response;
  try {
    response = await fetch(upstream, {
      headers: {
        accept: "application/geo+json",
        "user-agent": USER_AGENT,
      },
    });
  } catch {
    return json({ error: "Official alert source is temporarily unavailable" }, 502, 0);
  }

  if (!response.ok) {
    return json({
      error: "Official alert source returned an error",
      upstreamStatus: response.status,
    }, 502, 0);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return json({ error: "Official alert source returned invalid data" }, 502, 0);
  }

  const now = Date.now();
  const alerts = (Array.isArray(payload?.features) ? payload.features : [])
    .map(normalize)
    .filter((alert) => String(alert.status).toLowerCase() === "actual")
    .filter((alert) => !["test", "exercise"].includes(String(alert.messageType).toLowerCase()))
    .filter((alert) => !alert.expires || Date.parse(alert.expires) > now)
    .filter((alert) =>
      mode === "amber"
        ? alert.event === "Child Abduction Emergency"
        : PUBLIC_SAFETY_EVENTS.has(alert.event)
    )
    .sort((a, b) => Date.parse(b.sent || 0) - Date.parse(a.sent || 0));

  return json({
    source: {
      name: "National Weather Service Alerts API",
      official: true,
      delayedArchive: false,
    },
    mode,
    area: area || "US",
    fetchedAt: new Date().toISOString(),
    count: alerts.length,
    alerts,
    disclaimer:
      "Read-only redistribution of official alerts. Activate Siren cannot create, issue, modify, or cancel an AMBER Alert or other government alert.",
  });
};

export const config = {
  path: "/api/official-alerts",
};
