import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTokenAmount, validateEntries } from "../src/features/payroll/model.ts";

const CUSDT = { symbol: "cUSDT", decimals: 6, address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA" };
const MULTISEND_ADDRESS = "0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91";

test("parses exact token units", () => {
  assert.equal(parseTokenAmount("10,000", 6), 10_000_000_000n);
  assert.equal(parseTokenAmount("10,000.000001", 6), 10_000_000_001n);
});

test("keeps recipient and uint64 validation before payment", () => {
  const result = validateEntries([
    { id: "valid", recipient: "0x3Ba1c4409A614A8cB4D1B52D0c3cF9fF4aC2bB02", amount: "1" },
    { id: "invalid", recipient: MULTISEND_ADDRESS, amount: "18,446,744,073,709.551616" },
  ], CUSDT, MULTISEND_ADDRESS);

  assert.equal(result.total, undefined);
  assert.equal(result.entries.invalid.recipient, "The multisend contract cannot receive a payment.");
  assert.equal(result.entries.invalid.amount, "Amount is larger than encrypted uint64.");
});
