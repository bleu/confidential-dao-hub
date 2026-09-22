import assert from "node:assert/strict";
import { test } from "node:test";
import { createDecryptionClient } from "../src/lib/decryption-client.ts";

const vault = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const alice = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bob = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const handle = `0x${"1".repeat(64)}`;
const pair = { handle, contractAddress: vault };
const scope = { chainId: 11155111, contractAddresses: [vault, token] };
const sign = async () => "0x1234";

function backend(decrypt = async () => ({ [handle]: 42n })) {
  const requests = [];
  const signatures = [];
  const sdk = {
    generateKeypair: () => ({ publicKey: "public", privateKey: "private" }),
    createEIP712: (...args) => {
      signatures.push(args);
      return {
        domain: {},
        types: { UserDecryptRequestVerification: [] },
        message: {},
      };
    },
    userDecrypt: (...args) => {
      requests.push(args);
      return decrypt(...args);
    },
  };
  return { load: async () => sdk, requests, signatures };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("signs only the feature scope, reuses its session, and caches by contract and handle", async () => {
  const sdk = backend();
  const client = createDecryptionClient(scope, alice, sdk.load);
  assert.equal((await client.userDecrypt([pair], sign)).get(handle), 42n);
  await client.userDecrypt([pair], sign);
  assert.equal(sdk.requests.length, 1);
  assert.equal(client.getCachedDecryption(handle, token), undefined);
  await client.userDecrypt([{ handle, contractAddress: token }], sign);
  assert.equal(sdk.requests.length, 2);
  assert.equal(sdk.signatures.length, 1);
  assert.deepEqual(sdk.requests[0][4], [vault, token]);
  assert.equal(sdk.requests[0][5], alice);
});

test("another wallet, feature, or disconnected client cannot read cached plaintext", async () => {
  const sdk = backend();
  const first = createDecryptionClient(scope, alice, sdk.load);
  await first.userDecrypt([pair], sign);
  for (const client of [
    createDecryptionClient(scope, bob, sdk.load),
    createDecryptionClient(
      { ...scope, contractAddresses: [token] },
      alice,
      sdk.load,
    ),
    createDecryptionClient(scope, undefined, sdk.load),
  ])
    assert.equal(client.getCachedDecryption(handle, vault), undefined);
  const disconnected = createDecryptionClient(scope, undefined, sdk.load);
  await assert.rejects(
    disconnected.userDecrypt([pair], sign),
    /Connect a wallet/,
  );
});

test("rejects out-of-scope contracts even if their handle was previously decrypted", async () => {
  const sdk = backend();
  const client = createDecryptionClient(
    { ...scope, contractAddresses: [vault] },
    alice,
    sdk.load,
  );
  await client.userDecrypt([pair], sign);
  await assert.rejects(
    client.userDecrypt([{ handle, contractAddress: token }], sign),
    /outside/,
  );
  assert.equal(sdk.requests.length, 1);
});

test("clearing invalidates pending decryption and prevents stale plaintext from returning", async () => {
  const result = deferred();
  const entered = deferred();
  const sdk = backend(() => {
    entered.resolve();
    return result.promise;
  });
  const client = createDecryptionClient(scope, alice, sdk.load);
  const pending = client.userDecrypt([pair], sign);
  await entered.promise;
  client.clear();
  result.resolve({ [handle]: 42n });
  await assert.rejects(pending, /session changed/);
  assert.equal(client.getCachedDecryption(handle, vault), undefined);
});

test("clearing while signing never submits the old session to the relayer", async () => {
  const signature = deferred();
  const entered = deferred();
  const sdk = backend();
  const client = createDecryptionClient(scope, alice, sdk.load);
  const pending = client.userDecrypt([pair], () => {
    entered.resolve();
    return signature.promise;
  });
  await entered.promise;
  client.clear();
  signature.resolve("0x1234");
  await assert.rejects(pending, /session changed/);
  assert.equal(sdk.requests.length, 0);
  await client.userDecrypt([pair], sign);
  assert.equal(sdk.signatures.length, 2);
});

test("concurrent requests share one signature, rejected signatures can be retried", async () => {
  const sdk = backend();
  const client = createDecryptionClient(scope, alice, sdk.load);
  await assert.rejects(
    client.userDecrypt([pair], async () => {
      throw new Error("Rejected");
    }),
    /Rejected/,
  );
  await Promise.all([
    client.userDecrypt([pair], sign),
    client.userDecrypt([pair], sign),
  ]);
  assert.equal(sdk.signatures.length, 2);
});

test("expired sessions request a fresh signature for uncached values", async (t) => {
  const sdk = backend();
  const client = createDecryptionClient(scope, alice, sdk.load);
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  await client.userDecrypt([pair], sign);
  Date.now.mock.mockImplementation(() => now + 8 * 86400 * 1000);
  await client.userDecrypt([{ handle, contractAddress: token }], sign);
  assert.equal(sdk.signatures.length, 2);
});

test("clear removes cached plaintext and notifies subscribers", async () => {
  const sdk = backend();
  const client = createDecryptionClient(scope, alice, sdk.load);
  let notifications = 0;
  const unsubscribe = client.subscribe(() => {
    notifications++;
  });
  await client.userDecrypt([pair], sign);
  client.clear();
  assert.equal(client.getCachedDecryption(handle, vault), undefined);
  assert.equal(notifications, 2);
  unsubscribe();
});
