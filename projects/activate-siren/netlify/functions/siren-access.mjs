import {
  createVisitor,
  authenticateVisitor,
  consumeFreeUse,
  json,
  visitorView,
} from "./_access-lib.mjs";

export default async (req) => {
  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}

    if (body.action === "bootstrap") {
      try {
        const created = await createVisitor();
        return json({
          accessToken: created.accessToken,
          access: visitorView(created.record),
        }, 201);
      } catch {
        return json({ error: "Could not create access identity" }, 500);
      }
    }

    if (body.action === "consume") {
      const result = await consumeFreeUse(req);

      if (result.error === "unauthorized") {
        return json({ error: "Unauthorized" }, 401);
      }
      if (result.error === "conflict") {
        return json({ error: "Please retry the activation" }, 409);
      }

      if (!result.allowed) {
        return json({
          allowed: false,
          paymentRequired: true,
          access: result.view,
        }, 402);
      }

      return json({
        allowed: true,
        counted: result.counted,
        paymentRequired: false,
        access: result.view,
      });
    }

    return json({ error: "Unsupported action" }, 400);
  }

  if (req.method === "GET") {
    const auth = await authenticateVisitor(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    return json({
      access: visitorView(auth.record),
    });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/siren-access",
};
