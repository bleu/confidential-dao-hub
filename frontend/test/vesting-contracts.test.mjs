import assert from "node:assert/strict";
import test from "node:test";

import {
  findVestingToken,
  formatVestingTokenAmount,
  VESTING_CHAIN_ID,
  VESTING_CONTRACT,
  VESTING_DECRYPTION_SCOPE,
  VESTING_DEPLOYMENT_BLOCK,
  VESTING_TOKENS,
  tokenAbi,
  vestingAbi,
} from "../src/features/vesting/contracts.ts";
import { createDecryptionClient } from "../src/lib/decryption-client.ts";

const wallet = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const handle = `0x${"01".repeat(32)}`;

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("limits vesting decryption to the deployed vesting contract", () => {
  assert.equal(VESTING_CHAIN_ID, 11155111);
  assert.equal(VESTING_DEPLOYMENT_BLOCK, 11_766_387n);
  assert.deepEqual(VESTING_DECRYPTION_SCOPE, {
    chainId: 11155111,
    contractAddresses: [VESTING_CONTRACT],
  });
});

test("configures cTOKEN and cUSDT creation with required write surfaces", () => {
  assert.deepEqual(VESTING_TOKENS, [
    {
      address: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f",
      symbol: "cTOKEN",
      decimals: 6,
    },
    {
      address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA",
      symbol: "cUSDT",
      decimals: 6,
    },
  ]);
  assert.equal(vestingAbi.some((item) => item.type === "function" && item.name === "createGrant"), true);
  assert.equal(vestingAbi.some((item) => item.type === "function" && item.name === "claim"), true);
  assert.equal(vestingAbi.some((item) => item.type === "function" && item.name === "revoke"), true);
  assert.equal(vestingAbi.some((item) => item.type === "function" && item.name === "retryRefund"), true);
  assert.equal(tokenAbi.some((item) => item.type === "function" && item.name === "isOperator"), true);
  assert.equal(tokenAbi.some((item) => item.type === "function" && item.name === "setOperator"), true);
});

test("formats configured vesting token amounts without guessing unknown decimals", () => {
  const cUsdt = findVestingToken("0x5FFB152C8D371AE59C25689C9F0F6E8A914CCBCA");

  assert.deepEqual(cUsdt, VESTING_TOKENS[1]);
  assert.equal(formatVestingTokenAmount(1_000_000n, cUsdt), "1 cUSDT");
  assert.equal(formatVestingTokenAmount(12_500_001n, cUsdt), "12.500001 cUSDT");
  assert.equal(findVestingToken("0x0000000000000000000000000000000000000001"), undefined);
});

test("a reset vesting scope rejects a stale private read", async () => {
  const result = deferred();
  const entered = deferred();
  const sdk = {
    generateKeypair: () => ({ publicKey: "public", privateKey: "private" }),
    createEIP712: () => ({
      domain: {},
      types: { UserDecryptRequestVerification: [] },
      message: {},
    }),
    userDecrypt: () => {
      entered.resolve();
      return result.promise;
    },
  };
  const client = createDecryptionClient(
    VESTING_DECRYPTION_SCOPE,
    wallet,
    async () => sdk,
  );
  const pending = client.userDecrypt(
    [{ handle, contractAddress: VESTING_CONTRACT }],
    async () => "0x1234",
  );

  await entered.promise;
  client.clear();
  result.resolve({ [handle]: 100n });

  await assert.rejects(pending, /session changed/);
  assert.equal(client.getCachedDecryption(handle, VESTING_CONTRACT), undefined);
});
