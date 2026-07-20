import assert from "node:assert/strict";
import test from "node:test";

import {
  isExpectedPortOnePaymentChannel,
  PortOneIntegrationError,
  readVerifiedPortOnePaymentMethod,
} from "../../src/lib/portone/server.ts";

function assertMethodMismatch(action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof PortOneIntegrationError);
    assert.equal(error.code, "payment_method_verification_failed");
    assert.equal(error.status, 409);
    return true;
  });
}

test("PortOne channel verification binds an attempt to its exact channel", () => {
  const channel = {
    type: "TEST",
    key: "channel-key-card",
  };

  assert.equal(
    isExpectedPortOnePaymentChannel(
      "PAID",
      channel,
      "TEST",
      "channel-key-card",
    ),
    true,
  );
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "PAID",
      channel,
      "TEST",
      "channel-key-kakaopay",
    ),
    false,
  );
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "PAID",
      channel,
      "LIVE",
      "channel-key-card",
    ),
    false,
  );
});

test("PortOne permits missing pre-selection channel details only for SDK-optional states", () => {
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "READY",
      undefined,
      "TEST",
      "channel-key-card",
    ),
    true,
  );
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "FAILED",
      undefined,
      "TEST",
      "channel-key-card",
    ),
    true,
  );
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "PAY_PENDING",
      undefined,
      "TEST",
      "channel-key-card",
    ),
    false,
  );
  assert.equal(
    isExpectedPortOnePaymentChannel(
      "PAID",
      undefined,
      "TEST",
      "channel-key-card",
    ),
    false,
  );
});

test("PortOne terminal methods must match the immutable requested method", () => {
  assert.equal(
    readVerifiedPortOnePaymentMethod(
      "PAID",
      { type: "PaymentMethodCard" },
      "CARD",
    ).paymentMethod,
    "CARD",
  );
  assert.equal(
    readVerifiedPortOnePaymentMethod(
      "VIRTUAL_ACCOUNT_ISSUED",
      {
        type: "PaymentMethodVirtualAccount",
        accountNumber: "masked-account",
      },
      "VIRTUAL_ACCOUNT",
    ).paymentMethod,
    "VIRTUAL_ACCOUNT",
  );

  assertMethodMismatch(() =>
    readVerifiedPortOnePaymentMethod(
      "PAID",
      { type: "PaymentMethodCard" },
      "VIRTUAL_ACCOUNT",
    ),
  );
  assertMethodMismatch(() =>
    readVerifiedPortOnePaymentMethod("CANCELLED", undefined, "CARD"),
  );
});

test("PortOne EASY_PAY verification accepts KakaoPay only", () => {
  assert.equal(
    readVerifiedPortOnePaymentMethod(
      "PAID",
      { type: "PaymentMethodEasyPay", provider: "KAKAOPAY" },
      "EASY_PAY",
    ).paymentMethod,
    "EASY_PAY:KAKAOPAY",
  );

  assertMethodMismatch(() =>
    readVerifiedPortOnePaymentMethod(
      "PAID",
      { type: "PaymentMethodEasyPay", provider: "NAVERPAY" },
      "EASY_PAY",
    ),
  );
  assertMethodMismatch(() =>
    readVerifiedPortOnePaymentMethod(
      "PAID",
      { type: "PaymentMethodEasyPay" },
      "EASY_PAY",
    ),
  );
});

test("PortOne pending and pre-selection failed states may omit method details", () => {
  for (const status of ["READY", "PAY_PENDING", "FAILED"]) {
    assert.deepEqual(
      readVerifiedPortOnePaymentMethod(status, undefined, "CARD"),
      {
        paymentMethod: null,
        vbankNum: null,
        vbankBank: null,
        vbankDue: null,
      },
    );
  }

  assertMethodMismatch(() =>
    readVerifiedPortOnePaymentMethod(
      "PAY_PENDING",
      { type: "PaymentMethodVirtualAccount", accountNumber: "masked-account" },
      "CARD",
    ),
  );
});
