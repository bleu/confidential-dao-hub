import { describe, expect, it, vi } from "vitest";

import { describeConfirmation } from "../src/features/vesting/CreateGrantPanel";

const actions = {
  authorize: vi.fn(),
  submit: vi.fn(),
  retryPrivateCheck: vi.fn(),
  reset: vi.fn(),
};

function confirmation(overrides = {}) {
  return describeConfirmation({
    creation: undefined,
    operatorReady: true,
    operatorLoading: false,
    pending: null,
    transactionError: null,
    ...actions,
    ...overrides,
  });
}

describe("describeConfirmation", () => {
  it("labels each authorization and creation step", () => {
    expect(confirmation({ operatorReady: false }).label).toBe("Authorize vesting contract");
    expect(confirmation({ operatorReady: false, pending: "vesting-operator" }).label).toBe("Authorizing...");
    expect(confirmation().label).toBe("Encrypt and create grant");
    expect(confirmation({ creation: { state: "encrypting" } }).label).toBe("Encrypting grant allocation...");
    expect(confirmation({ creation: { state: "transaction-pending", hash: "0x1234" } }).label).toBe("Transaction pending...");
    expect(confirmation({ creation: { state: "mined-awaiting-private-check", grantId: 1n } }).label).toBe("Verifying funding privately...");
  });

  it("keeps retries and a new grant distinct", () => {
    expect(confirmation({ creation: { state: "transaction-error", message: "rejected" } }).label).toBe("Retry grant creation");
    expect(confirmation({ creation: { state: "retryable-decryption-error", grantId: 1n } }).label).toBe("Retry private funding check");
    expect(confirmation({ creation: { state: "zero-funded", grantId: 1n, allocation: 0n } }).label).toBe("Create a new grant");
  });
});
