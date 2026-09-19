const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  return json({
    status: "ok",
    service: "activate-siren",
    timestamp: new Date().toISOString(),
    deployment: {
      provider: "netlify",
      context: process.env.CONTEXT || null,
      commitRef: process.env.COMMIT_REF || null,
      siteName: process.env.SITE_NAME || null,
      deployId: process.env.DEPLOY_ID || null,
    },
    capabilities: {
      localSiren: true,
      offlineShell: true,
      safetySessions: true,
      consentedLocation: true,
      trustedContacts: true,
      officialAlerts: true,
      sirenAccessGate: true,
      paypalUnlockBackend: true,
    },
    providers: {
      emailConfigured: Boolean(
        process.env.RESEND_API_KEY &&
        process.env.RESEND_FROM_EMAIL
      ),
      smsConfigured: Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER
      ),
      paypalConfigured: Boolean(
        process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET
      ),
      paypalWebhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      creatorBypassConfigured: Boolean(
        process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID
      ),
    },
  });
};

export const config = {
  path: "/api/health",
};
