import {
  accessStore,
  amountMatches,
  json,
  paypalAccessToken,
  paypalConfig,
  recordCaptureOnce,
  unlockVisitor,
} from "./_access-lib.mjs";

const header = (req, name) => req.headers.get(name) || "";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const config = paypalConfig();
  if (!config.clientId || !config.clientSecret || !config.webhookId) {
    return json({ error: "PayPal webhook is not configured" }, 503);
  }

  const raw = await req.text();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  let token;
  try {
    token = await paypalAccessToken(config);
  } catch (error) {
    return json({ error: error.message || "PayPal authentication failed" }, 502);
  }

  const verifyResponse = await fetch(
    `${config.baseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        auth_algo: header(req, "paypal-auth-algo"),
        cert_url: header(req, "paypal-cert-url"),
        transmission_id: header(req, "paypal-transmission-id"),
        transmission_sig: header(req, "paypal-transmission-sig"),
        transmission_time: header(req, "paypal-transmission-time"),
        webhook_id: config.webhookId,
        webhook_event: event,
      }),
    }
  );

  const verification = await verifyResponse.json().catch(() => ({}));
  if (
    !verifyResponse.ok ||
    verification.verification_status !== "SUCCESS"
  ) {
    return json({ error: "Invalid PayPal webhook signature" }, 400);
  }

  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return json({ received: true, ignored: true });
  }

  const resource = event.resource || {};
  const captureId = String(resource.id || "");
  const orderId = String(
    resource?.supplementary_data?.related_ids?.order_id || ""
  );

  if (!captureId || !orderId) {
    return json({ received: true, ignored: true });
  }

  const store = accessStore();
  const orderMap = await store.get(`order:${orderId}`, {
    type: "json",
    consistency: "strong",
  });

  if (!orderMap) {
    return json({ received: true, ignored: true });
  }

  if (
    resource.status !== "COMPLETED" ||
    !amountMatches(resource.amount, orderMap.amount, orderMap.currency)
  ) {
    return json({ received: true, ignored: true });
  }

  const once = await recordCaptureOnce({
    captureId,
    visitorId: orderMap.visitorId,
    orderId,
    amount: orderMap.amount,
    currency: orderMap.currency,
  });

  if (!once.ok) {
    return json({ received: true, ignored: true });
  }

  const unlocked = await unlockVisitor(orderMap.visitorId, {
    captureId,
    orderId,
  });

  if (unlocked.error) {
    return json({ error: "Verified payment could not be applied" }, 500);
  }

  return json({
    received: true,
    unlocked: true,
    duplicateCapture: once.duplicate,
  });
};

export const config = {
  path: "/api/paypal/webhook",
};
