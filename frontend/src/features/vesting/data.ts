import { isAddress, parseUnits, zeroAddress, type Address, type Hex } from "viem";

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

const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

export type CreateGrantInput = {
  recipient: string;
  token: Address;
  vestingContract: Address;
  allocation: string;
  tokenDecimals: number;
  start: bigint;
  end: bigint;
  cliff: bigint | null;
  revocable: boolean;
};

export type CreateGrantRequest = {
  recipient: Address;
  token: Address;
  allocation: bigint;
  start: bigint;
  end: bigint;
  cliff: bigint;
  revocable: boolean;
};

export type CreateGrantPreview = {
  accrued: bigint;
  vested: bigint;
  available: bigint;
  cliffPassed: boolean;
};

export type CreateGrantErrors = Partial<
  Record<"recipient" | "allocation" | "start" | "end" | "cliff", string>
>;

export type CreateGrantPreparation =
  | { request: CreateGrantRequest; preview: CreateGrantPreview }
  | { errors: CreateGrantErrors };

export function prepareCreateGrant(
  input: CreateGrantInput,
  nowSeconds: bigint,
): CreateGrantPreparation {
  const errors: CreateGrantErrors = {};
  const recipient = parseRecipient(input.recipient);
  const allocation = parseAllocation(input.allocation, input.tokenDecimals);

  if (!recipient || recipient === zeroAddress || recipient.toLowerCase() === input.vestingContract.toLowerCase()) {
    errors.recipient = "Enter a recipient wallet.";
  }
  if (allocation === undefined || allocation === 0n) {
    errors.allocation = "Enter a positive allocation.";
  } else if (allocation > MAX_UINT64) {
    errors.allocation = "Allocation exceeds the supported limit.";
  }
  if (!isUint48(input.start)) errors.start = "Start must be a valid date.";
  if (!isUint48(input.end) || input.end <= input.start || input.end <= nowSeconds) {
    errors.end = "End must follow start and be in the future.";
  }
  if (
    input.cliff !== null &&
    (!isUint48(input.cliff) || input.cliff < input.start || input.cliff > input.end)
  ) {
    errors.cliff = "Cliff must fall between start and end.";
  }
  if (Object.keys(errors).length > 0) return { errors };

  const request: CreateGrantRequest = {
    recipient: recipient!,
    token: input.token,
    allocation: allocation!,
    start: input.start,
    end: input.end,
    cliff: input.cliff ?? 0n,
    revocable: input.revocable,
  };
  return { request, preview: previewCreateGrant(request, nowSeconds) };
}

export function previewCreateGrant(
  request: CreateGrantRequest,
  nowSeconds: bigint,
): CreateGrantPreview {
  const accrued =
    nowSeconds <= request.start
      ? 0n
      : nowSeconds >= request.end
        ? request.allocation
        : (request.allocation * (nowSeconds - request.start)) /
          (request.end - request.start);
  const cliffPassed = request.cliff === 0n || nowSeconds >= request.cliff;
  const vested = cliffPassed ? accrued : 0n;

  return { accrued, vested, available: vested, cliffPassed };
}

function parseRecipient(value: string): Address | undefined {
  return isAddress(value, { strict: false }) ? (value as Address) : undefined;
}

function parseAllocation(value: string, decimals: number): bigint | undefined {
  try {
    return parseUnits(value, decimals);
  } catch {
    return undefined;
  }
}

function isUint48(value: bigint): boolean {
  return value >= 0n && value <= MAX_UINT48;
}
