import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("configures cTOKEN creation and its required write surfaces", () => {
  assert.deepEqual(VESTING_TOKENS, [
    {
      address: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f",
      symbol: "cTOKEN",
      decimals: 6,
    },
  ]);
  assert.equal(vestingAbi.some((item) => item.type === "function" && item.name === "createGrant"), true);
  assert.equal(tokenAbi.some((item) => item.type === "function" && item.name === "isOperator"), true);
  assert.equal(tokenAbi.some((item) => item.type === "function" && item.name === "setOperator"), true);
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
