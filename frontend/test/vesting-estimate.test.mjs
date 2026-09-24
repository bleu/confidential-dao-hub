import assert from "node:assert/strict";
import test from "node:test";

import { estimateGrant, normalizeGrant } from "../src/features/vesting/data.ts";

const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const recipient = "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4";
const token = "0x0a73c1167cE82040dE1a1BEf47d4a32e8431A9D4";
const handle = `0x${"01".repeat(32)}`;

function grant(overrides = {}) {
  return normalizeGrant(1n, {
    treasury,
    recipient,
    token,
    start: 100n,
    end: 500n,
    cliff: 200n,
    revocable: true,
    revoked: false,
    revokedAt: 0n,
    allocation: handle,
    claimed: handle,
    refundEntitlement: handle,
    refunded: handle,
    ...overrides,
  });
}

test("makes vesting accrued since start available at the cliff", () => {
  const estimate = estimateGrant(
    grant(),
    {
      allocation: 1_000n,
      claimed: 100n,
      refundEntitlement: 0n,
      refunded: 0n,
    },
    200n,
  );

  assert.deepEqual(estimate, {
    vested: 250n,
    available: 150n,
    unvested: 750n,
    outstandingRefund: 0n,
  });
});

test("stops vesting at revocation and tracks refund retries", () => {
  const estimate = estimateGrant(
    grant({ revoked: true, revokedAt: 300n }),
    {
      allocation: 1_000n,
      claimed: 100n,
      refundEntitlement: 500n,
      refunded: 125n,
    },
    450n,
  );

  assert.deepEqual(estimate, {
    vested: 500n,
    available: 400n,
    unvested: 500n,
    outstandingRefund: 375n,
  });
});

test("uses the full allocation at the schedule end", () => {
  const estimate = estimateGrant(
    grant(),
    {
      allocation: 1_001n,
      claimed: 1_000n,
      refundEntitlement: 0n,
      refunded: 0n,
    },
    500n,
  );

  assert.deepEqual(estimate, {
    vested: 1_001n,
    available: 1n,
    unvested: 0n,
    outstandingRefund: 0n,
  });
});
