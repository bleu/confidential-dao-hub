import assert from "node:assert/strict";
import test from "node:test";

import { runGrantAction, retryGrantActionVerification } from "../src/features/vesting/grantActions.ts";

const before = {
  allocation: 100n,
  claimed: 10n,
  refundEntitlement: 0n,
  refunded: 0n,
};

function adapters({ current = () => true, after = before } = {}) {
  const calls = [];
  return {
    calls,
    current,
    submit: async (action, grantId, onSubmitted) => {
      calls.push(["submit", action, grantId]);
      onSubmitted("0xabc");
      return { status: "success" };
    },
    readGrant: async (grantId) => {
      calls.push(["read", grantId]);
      return { grantId };
    },
    decryptAmounts: async (grant) => {
      calls.push(["decrypt", grant]);
      if (after instanceof Error) throw after;
      return after;
    },
  };
}

test("confirms a recipient claim only from its private claimed delta", async () => {
  const client = adapters({ after: { ...before, claimed: 35n } });
  const states = [];

  const result = await runGrantAction("claim", 7n, before, client, (state) => states.push(state));

  assert.deepEqual(result, { state: "verified-paid", action: "claim", amount: 25n });
  assert.deepEqual(states.map((state) => state.state), ["transaction-pending", "mined-awaiting-private-check", "verified-paid"]);
  assert.deepEqual(client.calls, [
    ["submit", "claim", 7n],
    ["read", 7n],
    ["decrypt", { grantId: 7n }],
  ]);
});

test("does not report a mined zero claim as a payment", async () => {
  const result = await runGrantAction("claim", 7n, before, adapters(), () => {});

  assert.deepEqual(result, { state: "verified-zero-transfer", action: "claim" });
});

test("separates stopped vesting from a refund result", async () => {
  const after = { ...before, refundEntitlement: 90n, refunded: 30n };

  const result = await runGrantAction("revoke", 7n, before, adapters({ after }), () => {});

  assert.deepEqual(result, {
    state: "verified-revoked",
    refunded: 30n,
    outstandingRefund: 60n,
  });
});

test("keeps an outstanding refund retryable after a zero retry", async () => {
  const snapshot = { ...before, refundEntitlement: 90n, refunded: 30n };
  const client = adapters({ after: snapshot });

  const result = await runGrantAction("retry-refund", 7n, snapshot, client, () => {});

  assert.deepEqual(result, {
    state: "verified-zero-transfer",
    action: "retry-refund",
    outstandingRefund: 60n,
  });
});

test("keeps private verification retryable without another transaction", async () => {
  const client = adapters({ after: new Error("signature rejected") });

  const first = await runGrantAction("claim", 7n, before, client, () => {});
  assert.deepEqual(first, { state: "retryable-decryption-error", action: "claim", grantId: 7n });

  client.decryptAmounts = async () => ({ ...before, claimed: 20n });
  const retried = await retryGrantActionVerification("claim", 7n, before, client, () => {});

  assert.deepEqual(retried, { state: "verified-paid", action: "claim", amount: 10n });
  assert.equal(client.calls.filter(([name]) => name === "submit").length, 1);
});

test("does not surface a private result after the wallet context changes", async () => {
  let isCurrent = true;
  const client = adapters({ current: () => isCurrent, after: { ...before, claimed: 20n } });
  client.readGrant = async (grantId) => {
    isCurrent = false;
    return { grantId };
  };
  const states = [];

  const result = await runGrantAction("claim", 7n, before, client, (state) => states.push(state));

  assert.deepEqual(result, { state: "stale" });
  assert.deepEqual(states.map((state) => state.state), ["transaction-pending", "mined-awaiting-private-check", "stale"]);
});

test("keeps a rejected transaction separate from private verification", async () => {
  const client = adapters();
  client.submit = async () => {
    throw new Error("User rejected the request.");
  };

  const result = await runGrantAction("claim", 7n, before, client, () => {});

  assert.deepEqual(result, { state: "transaction-error", message: "User rejected the request." });
  assert.equal(client.calls.some(([name]) => name === "read" || name === "decrypt"), false);
});
