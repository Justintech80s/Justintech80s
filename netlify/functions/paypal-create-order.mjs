import { randomUUID } from "node:crypto";
import {
  accessStore,
  authenticateVisitor,
  json,
  paypalAccessToken,
  paypalConfig,
  visitorView,
} from "./_access-lib.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await authenticateVisitor(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const access = visitorView(auth.record);
  if (access.unlimited) {
    return json({ error: "Access is already unlimited", access }, 409);
  }
  if (!access.locked) {
    return json({
      error: "Free activations remain",
      access,
    }, 409);
  }

  const config = paypalConfig();
  if (!config.configured) {
    return json({
      error: "PayPal unlock is not configured",
      missing: config.missing,
    }, 503);
  }

  let token;
  try {
    token = await paypalAccessToken(config);
  } catch (error) {
    return json({ error: error.message || "PayPal authentication failed" }, 502);
  }

  const requestId = `siren-unlock-${auth.id}-${randomUUID()}`;
  const invoiceId = `siren-${auth.id.slice(0, 8)}-${Date.now()}`;
  const siteOrigin = new URL(req.url).origin;
  const returnUrl = `${siteOrigin}/?paypal=return`;
  const cancelUrl = `${siteOrigin}/?paypal=cancel`;

  const response = await fetch(`${config.baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      "paypal-request-id": requestId,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "activate-siren-unlock",
        custom_id: auth.id,
        invoice_id: invoiceId,
        description: "Activate Siren unlimited access",
        amount: {
          currency_code: config.currency,
          value: config.price,
        },
      }],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    return json({
      error: "PayPal order creation failed",
      detail: data?.message || data?.name || null,
    }, 502);
  }

  const order = {
    orderId: data.id,
    visitorId: auth.id,
    amount: config.price,
    currency: config.currency,
    environment: config.environment,
    status: data.status || "CREATED",
    createdAt: new Date().toISOString(),
  };

  await accessStore().setJSON(`order:${data.id}`, order, {
    onlyIfNew: true,
  });

  const approvalUrl = Array.isArray(data.links)
    ? data.links.find((link) => link?.rel === "approve")?.href || null
    : null;

  return json({
    orderId: data.id,
    status: data.status || null,
    approvalUrl,
    amount: {
      value: config.price,
      currency: config.currency,
    },
  }, 201);
};

export const config = {
  path: "/api/paypal/create-order",
};
