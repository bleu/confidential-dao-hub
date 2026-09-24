import type { Address, Hex } from "viem";

export type GrantRole = "created" | "received";

export type GrantHandles = {
  allocation: Hex;
  claimed: Hex;
  refundEntitlement: Hex;
  refunded: Hex;
};

export type PublicGrant = {
  id: bigint;
  treasury: Address;
  recipient: Address;
  token: Address;
  start: bigint;
  end: bigint;
  cliff: bigint | null;
  revocable: boolean;
  revokedAt: bigint | null;
  handles: GrantHandles;
};

export type VestingGrantRead = {
  treasury: Address;
  recipient: Address;
  token: Address;
  start: bigint;
  end: bigint;
  cliff: bigint;
  revocable: boolean;
  revoked: boolean;
  revokedAt: bigint;
  refundEntitlement: Hex;
  refunded: Hex;
  allocation: Hex;
  claimed: Hex;
};

export function normalizeGrant(id: bigint, grant: VestingGrantRead): PublicGrant {
  return {
    id,
    treasury: grant.treasury,
    recipient: grant.recipient,
    token: grant.token,
    start: grant.start,
    end: grant.end,
    cliff: grant.cliff === 0n ? null : grant.cliff,
    revocable: grant.revocable,
    revokedAt: grant.revoked ? grant.revokedAt : null,
    handles: {
      allocation: grant.allocation,
      claimed: grant.claimed,
      refundEntitlement: grant.refundEntitlement,
      refunded: grant.refunded,
    },
  };
}

export function grantRolesFor(grant: PublicGrant, wallet: Address): GrantRole[] {
  const roles: GrantRole[] = [];
  if (sameAddress(grant.treasury, wallet)) roles.push("created");
  if (sameAddress(grant.recipient, wallet)) roles.push("received");
  return roles;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export type GrantParty = "treasury" | "recipient";

export type VestingReadClient = {
  grantIdsForParty(query: {
    role: GrantParty;
    wallet: Address;
    fromBlock: bigint;
  }): Promise<readonly bigint[]>;
  readGrant(id: bigint): Promise<VestingGrantRead>;
};

export async function discoverVestingGrants(
  client: VestingReadClient,
  wallet: Address,
  fromBlock: bigint,
): Promise<PublicGrant[]> {
  const [created, received] = await Promise.all([
    client.grantIdsForParty({ role: "treasury", wallet, fromBlock }),
    client.grantIdsForParty({ role: "recipient", wallet, fromBlock }),
  ]);
  const ids = [...new Set([...created, ...received])].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  return Promise.all(
    ids.map(async (id) => normalizeGrant(id, await client.readGrant(id))),
  );
}

export type PrivateGrantAmounts = {
  allocation: bigint;
  claimed: bigint;
  refundEntitlement: bigint;
  refunded: bigint;
};

export type GrantEstimate = {
  vested: bigint;
  available: bigint;
  unvested: bigint;
  outstandingRefund: bigint;
};

export function estimateGrant(
  grant: PublicGrant,
  amounts: PrivateGrantAmounts,
  nowSeconds: bigint,
): GrantEstimate {
  const timestamp = grant.revokedAt ?? nowSeconds;
  const vested =
    timestamp < grant.start || (grant.cliff !== null && timestamp < grant.cliff)
      ? 0n
      : timestamp >= grant.end
        ? amounts.allocation
        : (amounts.allocation * (timestamp - grant.start)) /
          (grant.end - grant.start);

  return {
    vested,
    available: vested - amounts.claimed,
    unvested: amounts.allocation - vested,
    outstandingRefund: amounts.refundEntitlement - amounts.refunded,
  };
}

export type CiphertextPair = {
  handle: Hex;
  contractAddress: Address;
};

export function privateAmountPairs(
  grant: PublicGrant,
  contractAddress: Address,
): CiphertextPair[] {
  return [
    { handle: grant.handles.allocation, contractAddress },
    { handle: grant.handles.claimed, contractAddress },
    { handle: grant.handles.refundEntitlement, contractAddress },
    { handle: grant.handles.refunded, contractAddress },
  ];
}

export type FundingDecryptionState = "idle" | "decrypting" | "unavailable";
export type FundingState = "funded" | "zero-funded" | "unverified" | "unavailable";

export function fundingState(
  allocation: bigint | undefined,
  decryption: FundingDecryptionState,
): FundingState {
  if (allocation !== undefined) return allocation === 0n ? "zero-funded" : "funded";
  return decryption === "unavailable" ? "unavailable" : "unverified";
}
