import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_USE_LIMIT,
  amountMatches,
  completedCapture,
  paypalConfig,
  visitorView,
} from "../netlify/functions/_access-lib.mjs";

test("free-use model locks after exactly three uses", () => {
  const base = {
    id: "visitor-test",
    freeUses: 0,
    unlimited: false,
    unlockedAt: null,
  };

  assert.equal(FREE_USE_LIMIT, 3);
  assert.equal(visitorView(base).locked, false);
  assert.equal(visitorView({ ...base, freeUses: 2 }).remainingFreeUses, 1);
  assert.equal(visitorView({ ...base, freeUses: 3 }).locked, true);
  assert.equal(visitorView({ ...base, freeUses: 4 }).locked, true);
});

test("unlimited entitlement removes the three-use lock", () => {
  const view = visitorView({
    id: "visitor-paid",
    freeUses: 3,
    unlimited: true,
    unlockedAt: new Date().toISOString(),
  });
  assert.equal(view.locked, false);
  assert.equal(view.unlimited, true);
  assert.equal(view.remainingFreeUses, null);
});

test("creator visitor ID bypasses the use limit", () => {
  const previous = process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID;
  process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID = "creator-test";
  try {
    const view = visitorView({
      id: "creator-test",
      freeUses: 999,
      unlimited: false,
    });
    assert.equal(view.creator, true);
    assert.equal(view.unlimited, true);
    assert.equal(view.locked, false);
  } finally {
    if (previous === undefined) {
      delete process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID;
    } else {
      process.env.ACTIVATE_SIREN_CREATOR_VISITOR_ID = previous;
    }
  }
});

test("payment amount must match value and currency exactly", () => {
  assert.equal(
    amountMatches({ value: "9.99", currency_code: "USD" }, "9.99", "USD"),
    true
  );
  assert.equal(
    amountMatches({ value: "9.98", currency_code: "USD" }, "9.99", "USD"),
    false
  );
  assert.equal(
    amountMatches({ value: "9.99", currency_code: "EUR" }, "9.99", "USD"),
    false
  );
});

test("only a completed capture qualifies", () => {
  const pending = {
    purchase_units: [{
      payments: {
        captures: [{ id: "cap-1", status: "PENDING" }],
      },
    }],
  };
  const completed = {
    purchase_units: [{
      custom_id: "visitor-test",
      payments: {
        captures: [{
          id: "cap-2",
          status: "COMPLETED",
          amount: { value: "9.99", currency_code: "USD" },
        }],
      },
    }],
  };

  assert.equal(completedCapture(pending), null);
  assert.equal(completedCapture(completed)?.capture?.id, "cap-2");
});

test("PayPal configuration defaults to sandbox with a $5 USD unlock", () => {
  const previous = {
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    SIREN_UNLOCK_PRICE: process.env.SIREN_UNLOCK_PRICE,
    SIREN_UNLOCK_CURRENCY: process.env.SIREN_UNLOCK_CURRENCY,
  };

  process.env.PAYPAL_ENV = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "client";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  delete process.env.SIREN_UNLOCK_PRICE;
  process.env.SIREN_UNLOCK_CURRENCY = "USD";

  try {
    const config = paypalConfig();
    assert.equal(config.environment, "sandbox");
    assert.equal(config.configured, true);
    assert.equal(config.price, "5.00");
    assert.equal(config.currency, "USD");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
