import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canRollEpoch,
  isContractOwner,
  isDisclosureEligible,
  rollEpochReason,
  sameAddress,
  walletActionReason,
} from "../src/features/buybacks/permissions.ts";

const chainId = 11155111;
const alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const bob = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const wallet = (overrides = {}) => ({
  address: alice,
  chainId,
  expectedChainId: chainId,
  ...overrides,
});

test("compares wallet addresses without case sensitivity", () => {
  assert.equal(sameAddress(alice, alice.toLowerCase()), true);
  assert.equal(sameAddress(alice, bob), false);
  assert.equal(sameAddress(alice, undefined), false);
});

test("reports concise wallet action requirements", () => {
  assert.equal(walletActionReason(wallet({ address: undefined })), "Connect wallet");
  assert.equal(walletActionReason(wallet({ chainId: 1 })), "Switch to Sepolia");
  assert.equal(walletActionReason(wallet()), undefined);
});

test("allows contract owner actions only from the owner on the expected chain", () => {
  assert.equal(isContractOwner({ ...wallet(), owner: alice.toLowerCase() }), true);
  assert.equal(isContractOwner({ ...wallet(), owner: bob }), false);
  assert.equal(isContractOwner({ ...wallet({ chainId: 1 }), owner: alice }), false);
});

test("allows early rolls for the owner and expired rolls for any correct-chain wallet", () => {
  const ownerEarly = { ...wallet(), owner: alice, windowExpired: false };
  const sellerEarly = { ...wallet({ address: bob }), owner: alice, windowExpired: false };
  const sellerExpired = { ...sellerEarly, windowExpired: true };

  assert.equal(canRollEpoch(ownerEarly), true);
  assert.equal(canRollEpoch(sellerEarly), false);
  assert.equal(rollEpochReason(sellerEarly), "Wait for window expiry");
  assert.equal(canRollEpoch(sellerExpired), true);
  assert.equal(canRollEpoch({ ...sellerExpired, chainId: 1 }), false);
});

test("allows disclosure only after the full delay and before publication", () => {
  const base = { closedAt: 1_000n, delaySeconds: 300, disclosed: false };
  assert.equal(isDisclosureEligible({ ...base, now: 1_299 }), false);
  assert.equal(isDisclosureEligible({ ...base, now: 1_300 }), true);
  assert.equal(isDisclosureEligible({ ...base, now: 1_400, disclosed: true }), false);
  assert.equal(isDisclosureEligible({ ...base, closedAt: 0n, now: 1_300 }), false);
});
