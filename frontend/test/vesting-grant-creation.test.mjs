import assert from "node:assert/strict";
import test from "node:test";

import { createGrant, retryPrivateFundingCheck } from "../src/features/vesting/grantCreation.ts";

const request = {
  recipient: "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4",
  token: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f",
  allocation: 12_500_000n,
  start: 1_700_000_000n,
  end: 1_800_000_000n,
  cliff: 0n,
  revocable: false,
};
const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const vestingContract = "0xD75E947e4262627E8fbE009585206F461afFA4b1";
const allocation = `0x${"03".repeat(32)}`;

function adapters({ decrypted = 12_500_000n, current = () => true } = {}) {
  const calls = [];
  return {
    calls,
    vestingContract,
    treasury,
    current,
    encrypt: async (contract, wallet, value) => {
      calls.push(["encrypt", contract, wallet, value]);
      return { handle: `0x${"01".repeat(32)}`, proof: `0x${"02".repeat(32)}` };
    },
    submit: async (args, onSubmitted) => {
      calls.push(["submit", args]);
      onSubmitted("0xabc");
      return { logs: ["grant-created"] };
    },
    grantIdFromReceipt: (receipt) => {
      calls.push(["receipt", receipt]);
      return 7n;
    },
    readGrant: async (id) => {
      calls.push(["read", id]);
      return { id, allocation };
    },
    decryptAllocation: async (grant) => {
      calls.push(["decrypt", grant]);
      if (decrypted instanceof Error) throw decrypted;
      return decrypted;
    },
  };
}

test("creates a grant then confirms its nonzero allocation privately", async () => {
  const client = adapters();
  const states = [];

  const result = await createGrant(request, client, (state) => states.push(state));

  assert.deepEqual(result, { state: "funded", grantId: 7n, allocation: 12_500_000n });
  assert.deepEqual(states.map((state) => state.state), ["encrypting", "transaction-pending", "mined-awaiting-private-check", "funded"]);
  assert.deepEqual(client.calls, [
    ["encrypt", vestingContract, treasury, 12_500_000n],
    ["submit", { ...request, handle: `0x${"01".repeat(32)}`, proof: `0x${"02".repeat(32)}` }],
    ["receipt", { logs: ["grant-created"] }],
    ["read", 7n],
    ["decrypt", { id: 7n, allocation }],
  ]);
});

test("reports zero funding and keeps a failed private check retryable without another write", async () => {
  const client = adapters({ decrypted: new Error("signature rejected") });

  const first = await createGrant(request, client, () => {});
  assert.deepEqual(first, { state: "retryable-decryption-error", grantId: 7n });

  const retried = await retryPrivateFundingCheck(7n, client, () => {});
  assert.deepEqual(retried, { state: "retryable-decryption-error", grantId: 7n });
  assert.equal(client.calls.filter(([name]) => name === "encrypt" || name === "submit").length, 2);

  const zero = await createGrant(request, adapters({ decrypted: 0n }), () => {});
  assert.deepEqual(zero, { state: "zero-funded", grantId: 7n, allocation: 0n });
});

test("does not surface a result after the wallet context changes", async () => {
  let isCurrent = true;
  const client = adapters({ current: () => isCurrent });
  const states = [];
  client.readGrant = async (id) => {
    isCurrent = false;
    return { id, allocation };
  };

  const result = await createGrant(request, client, (state) => states.push(state));

  assert.deepEqual(result, { state: "stale" });
  assert.deepEqual(states.map((state) => state.state), ["encrypting", "transaction-pending", "mined-awaiting-private-check", "stale"]);
  assert.equal(client.calls.some(([name]) => name === "decrypt"), false);
});

test("keeps a rejected create transaction separate from funding verification", async () => {
  const client = adapters();
  const states = [];
  client.submit = async () => {
    throw new Error("User rejected the request.");
  };

  const result = await createGrant(request, client, (state) => states.push(state));

  assert.deepEqual(result, { state: "transaction-error", message: "User rejected the request." });
  assert.deepEqual(states.map((state) => state.state), ["encrypting", "transaction-error"]);
  assert.equal(client.calls.some(([name]) => name === "read" || name === "decrypt"), false);
});
