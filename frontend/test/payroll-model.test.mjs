import assert from "node:assert/strict";
import { test } from "node:test";

import { hasEnoughBalance, parseTokenAmount, validateEntries } from "../src/features/payroll/model.ts";
import { isCurrentMockPrivateRead, mockPaymentPrivateReadScope } from "../src/features/payroll/mockPrivateState.ts";

const CUSDT = { symbol: "cUSDT", decimals: 6, address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA" };
const MULTISEND_ADDRESS = "0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91";

test("checks the mock balance with exact cUSDT units", () => {
  const balance = parseTokenAmount("10,000", 6);

  assert.equal(hasEnoughBalance(parseTokenAmount("10,000", 6), balance), true);
  assert.equal(hasEnoughBalance(parseTokenAmount("10,000.000001", 6), balance), false);
});

test("keeps recipient and uint64 validation before mock payment", () => {
  const result = validateEntries([
    { id: "valid", recipient: "0x3Ba1c4409A614A8cB4D1B52D0c3cF9fF4aC2bB02", amount: "1" },
    { id: "invalid", recipient: MULTISEND_ADDRESS, amount: "18,446,744,073,709.551616" },
  ], CUSDT, MULTISEND_ADDRESS);

  assert.equal(result.total, undefined);
  assert.equal(result.entries.invalid.recipient, "The multisend contract cannot receive a payment.");
  assert.equal(result.entries.invalid.amount, "Amount is larger than encrypted uint64.");
});

test("isolates mock private reads by payment and viewer, and discards stale completion", () => {
  const senderFirstPayment = mockPaymentPrivateReadScope("send:0xsender", "payment-1");
  const senderSecondPayment = mockPaymentPrivateReadScope("send:0xsender", "payment-2");
  const resetSenderFirstPayment = mockPaymentPrivateReadScope("send:0xsender:session:2", "payment-1");
  const receiverFirstPayment = mockPaymentPrivateReadScope("receive:0xreceiver", "payment-1");
  const decryptingSenderRead = { scope: senderFirstPayment, phase: "decrypting" };

  assert.equal(isCurrentMockPrivateRead(decryptingSenderRead, senderFirstPayment, 4, 4), true);
  assert.equal(isCurrentMockPrivateRead(decryptingSenderRead, senderSecondPayment, 4, 4), false);
  assert.equal(isCurrentMockPrivateRead(decryptingSenderRead, resetSenderFirstPayment, 4, 4), false);
  assert.equal(isCurrentMockPrivateRead(decryptingSenderRead, receiverFirstPayment, 4, 4), false);
  assert.equal(isCurrentMockPrivateRead(decryptingSenderRead, senderFirstPayment, 4, 5), false);
});
