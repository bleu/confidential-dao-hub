import assert from "node:assert/strict";
import test from "node:test";

import { discoverVestingGrants } from "../src/features/vesting/data.ts";
import {
  contractGrantRead,
  configuredToken as token,
  recipient,
  treasury as wallet,
  unconfiguredToken as otherToken,
} from "./fixtures/vesting-grants.mjs";

function rawGrant(treasury = wallet, grantRecipient = recipient) {
  return contractGrantRead({ grantTreasury: treasury, grantRecipient });
}

test("discovers both wallet roles from the deployment block and reads each grant once", async () => {
  const queries = [];
  const reads = [];
  const grants = await discoverVestingGrants(
    {
      async grantIdsForParty(query) {
        queries.push(query);
        return query.role === "treasury" ? [1n, 2n] : [2n, 3n];
      },
      async readGrant(id) {
        reads.push(id);
        return id === 3n
          ? rawGrant(recipient, wallet)
          : id === 2n
            ? { ...rawGrant(), token: otherToken }
            : rawGrant();
      },
    },
    wallet,
    11_766_387n,
  );

  assert.deepEqual(queries, [
    { role: "treasury", wallet, fromBlock: 11_766_387n },
    { role: "recipient", wallet, fromBlock: 11_766_387n },
  ]);
  assert.deepEqual(reads, [1n, 2n, 3n]);
  assert.deepEqual(grants.map((grant) => grant.id), [1n, 2n, 3n]);
  assert.deepEqual(grants.map((grant) => grant.token), [token, otherToken, token]);
});

test("returns a grant-read error to the caller", async () => {
  await assert.rejects(
    discoverVestingGrants(
      {
        async grantIdsForParty() {
          throw new Error("RPC unavailable");
        },
        async readGrant() {
          throw new Error("not reached");
        },
      },
      wallet,
      11_766_387n,
    ),
    /RPC unavailable/,
  );
});
