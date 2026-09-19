import {
  accessStore,
  amountMatches,
  authenticateVisitor,
  completedCapture,
  json,
  paypalAccessToken,
  paypalConfig,
  recordCaptureOnce,
  unlockVisitor,
} from "./_access-lib.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await authenticateVisitor(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  let body = {};
  try { body = await req.json(); } catch {}
  const orderId = String(body.orderId || "").trim();
  if (!orderId) return json({ error: "Missing PayPal order ID" }, 400);

  const store = accessStore();
  const orderMap = await store.get(`order:${orderId}`, {
    type: "json",
    consistency: "strong",
  });

  if (!orderMap || orderMap.visitorId !== auth.id) {
    return json({ error: "Order does not belong to this access identity" }, 403);
  }

  const config = paypalConfig();
  if (!config.configured) {
    return json({ error: "PayPal unlock is not configured" }, 503);
  }

  let token;
  try {
    token = await paypalAccessToken(config);
  } catch (error) {
    return json({ error: error.message || "PayPal authentication failed" }, 502);
  }

  const response = await fetch(
    `${config.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "paypal-request-id": `capture-${orderId}`,
      },
      body: "{}",
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 422) {
    return json({
      error: "PayPal capture request failed",
      detail: data?.message || data?.name || null,
    }, 502);
  }

  let orderData = data;

  // A retry may return an idempotency/conflict response. Read the order to
  // establish the actual capture state instead of unlocking on the retry response.
  if (!completedCapture(orderData)) {
    const show = await fetch(
      `${config.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      }
    );
    orderData = await show.json().catch(() => ({}));
    if (!show.ok) {
      return json({ error: "Could not verify PayPal order status" }, 502);
    }
  }

  const completed = completedCapture(orderData);
  if (!completed) {
    return json({
      error: "Payment is not completed",
      paymentStatus: orderData.status || null,
    }, 409);
  }

  if (
    completed.unit?.custom_id !== auth.id ||
    !amountMatches(
      completed.capture.amount,
      orderMap.amount,
      orderMap.currency
    )
  ) {
    return json({ error: "PayPal payment details did not match the unlock order" }, 409);
  }

  const once = await recordCaptureOnce({
    captureId: completed.capture.id,
    visitorId: auth.id,
    orderId,
    amount: orderMap.amount,
    currency: orderMap.currency,
  });

  if (!once.ok) {
    return json({ error: "This PayPal capture was already used" }, 409);
  }

  const unlocked = await unlockVisitor(auth.id, {
    captureId: completed.capture.id,
    orderId,
  });

  if (unlocked.error) {
    return json({ error: "Payment completed but unlock needs retry" }, 409);
  }

  return json({
    unlocked: true,
    duplicateCapture: once.duplicate,
    access: unlocked.view,
    paypal: {
      orderId,
      captureId: completed.capture.id,
      status: completed.capture.status,
    },
  });
};

export const config = {
  path: "/api/paypal/capture-order",
};
