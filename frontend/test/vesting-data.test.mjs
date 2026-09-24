import assert from "node:assert/strict";
import test from "node:test";

import {
  fundingState,
  privateAmountPairs,
  grantRolesFor,
  normalizeGrant,
  prepareCreateGrant,
} from "../src/features/vesting/data.ts";

import {
  configuredToken as token,
  contractGrantRead,
  dualRoleGrant,
  recipient,
  recipientOnlyGrant,
  treasury,
  treasuryOnlyGrant,
  unconfiguredTokenGrant,
} from "./fixtures/vesting-grants.mjs";

const rawGrant = contractGrantRead();

test("normalizes a grant without placing private amounts in its public model", () => {
  const grant = normalizeGrant(42n, rawGrant);

  assert.deepEqual(grant, {
    id: 42n,
    treasury,
    recipient,
    token,
    start: 1_700_000_000n,
    end: 1_800_000_000n,
    cliff: null,
    revocable: true,
    revokedAt: null,
    handles: {
      allocation: rawGrant.allocation,
      claimed: rawGrant.claimed,
      refundEntitlement: rawGrant.refundEntitlement,
      refunded: rawGrant.refunded,
    },
  });
});

test("builds private reads for the vesting contract instead of the grant token", () => {
  const grant = normalizeGrant(42n, rawGrant);
  const vestingContract = "0xD75E947e4262627E8fbE009585206F461afFA4b1";

  assert.deepEqual(privateAmountPairs(grant, vestingContract), [
    { handle: rawGrant.allocation, contractAddress: vestingContract },
    { handle: rawGrant.claimed, contractAddress: vestingContract },
    { handle: rawGrant.refundEntitlement, contractAddress: vestingContract },
    { handle: rawGrant.refunded, contractAddress: vestingContract },
  ]);
});

test("does not treat unavailable decryption as a zero-funded grant", () => {
  assert.equal(fundingState(undefined, "unavailable"), "unavailable");
  assert.equal(fundingState(undefined, "decrypting"), "unverified");
  assert.equal(fundingState(0n, "idle"), "zero-funded");
  assert.equal(fundingState(1n, "idle"), "funded");
});

test("keeps Treasury, Recipient, dual-role, and unconfigured-token grants distinct", () => {
  assert.deepEqual(grantRolesFor(treasuryOnlyGrant, treasury), ["created"]);
  assert.deepEqual(grantRolesFor(recipientOnlyGrant, treasury), ["received"]);
  assert.deepEqual(grantRolesFor(dualRoleGrant, treasury), ["created", "received"]);
  assert.equal(unconfiguredTokenGrant.token, "0x4b73c1167cE82040dE1a1BEf47d4a32e8431A9D4");
});

test("prepares a valid backdated grant and preserves its immediate vesting preview", () => {
  const result = prepareCreateGrant(
    {
      recipient,
      token,
      vestingContract: "0xD75E947e4262627E8fbE009585206F461afFA4b1",
      allocation: "12.5",
      tokenDecimals: 6,
      start: 1_700_000_000n,
      end: 1_800_000_000n,
      cliff: null,
      revocable: true,
    },
    1_750_000_000n,
  );

  assert.deepEqual(result, {
    request: {
      recipient,
      token,
      allocation: 12_500_000n,
      start: 1_700_000_000n,
      end: 1_800_000_000n,
      cliff: 0n,
      revocable: true,
    },
    preview: {
      accrued: 6_250_000n,
      vested: 6_250_000n,
      available: 6_250_000n,
      cliffPassed: true,
    },
  });
});

test("rejects invalid grant terms before encryption", () => {
  const result = prepareCreateGrant(
    {
      recipient: "0x0000000000000000000000000000000000000000",
      token,
      vestingContract: "0xD75E947e4262627E8fbE009585206F461afFA4b1",
      allocation: "0",
      tokenDecimals: 6,
      start: 1_800_000_000n,
      end: 1_700_000_000n,
      cliff: 1_600_000_000n,
      revocable: false,
    },
    1_750_000_000n,
  );

  assert.deepEqual(result, {
    errors: {
      recipient: "Enter a recipient wallet.",
      allocation: "Enter a positive allocation.",
      end: "End must follow start and be in the future.",
      cliff: "Cliff must fall between start and end.",
    },
  });
});
