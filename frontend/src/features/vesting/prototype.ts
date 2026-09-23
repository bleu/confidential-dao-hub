// Throwaway UI prototype. All data and transitions are local and simulated.

export const prototypeVariants = ["A", "B", "C"] as const;

export type PrototypeVariant = (typeof prototypeVariants)[number];
export type PrototypeWorkspace = "dao" | "community";
export type PrototypeView = "list" | "create" | "detail";
export type PrivateReadState = "hidden" | "decrypting" | "decrypted" | "unavailable";
export type CreationState = "review" | "authorizing" | "submitting" | "minedAwaitingVerification" | "funded" | "zeroFunded" | "rejected";
export type ClaimState = "idle" | "pending" | "paid" | "zeroPayout" | "rejected";
export type RevocationState = "idle" | "preview" | "pending" | "stopped";
export type RefundState = "idle" | "pending" | "paid" | "zeroOrFailed" | "rejected";

export type Token = {
  address: string;
  decimals: number;
  symbol: string;
  configured: boolean;
};

export type MockGrant = {
  id: string;
  treasury: string;
  recipient: string;
  token: Token;
  start: number;
  end: number;
  cliff: number | null;
  revocable: boolean;
  revokedAt: number | null;
  privateAmounts: {
    allocation: string;
    vested: string;
    available: string;
    claimed: string;
    unvested: string;
    refundEntitlement: string;
    refunded: string;
  };
  note: string;
};

const tokens = {
  cUsdc: {
    address: "0xC0fFEE000000000000000000000000000000001",
    decimals: 6,
    symbol: "cUSDC",
    configured: true,
  },
  cUsdt: {
    address: "0xC0fFEE000000000000000000000000000000002",
    decimals: 6,
    symbol: "cUSDT",
    configured: true,
  },
  unknown: {
    address: "0xF00D000000000000000000000000000000000003",
    decimals: 18,
    symbol: "Unknown token",
    configured: false,
  },
} as const satisfies Record<string, Token>;

export const mockGrants: MockGrant[] = [
  {
    id: "GR-1048",
    treasury: "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1",
    recipient: "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4",
    token: tokens.cUsdc,
    start: 1735689600,
    end: 1798761600,
    cliff: 1767225600,
    revocable: true,
    revokedAt: null,
    privateAmounts: {
      allocation: "48,000 cUSDC",
      vested: "18,240 cUSDC",
      available: "6,240 cUSDC",
      claimed: "12,000 cUSDC",
      unvested: "29,760 cUSDC",
      refundEntitlement: "0 cUSDC",
      refunded: "0 cUSDC",
    },
    note: "One-year cliff. The grant is active and revocable.",
  },
  {
    id: "GR-1021",
    treasury: "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1",
    recipient: "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4",
    token: tokens.cUsdt,
    start: 1722470400,
    end: 1785542400,
    cliff: 1754006400,
    revocable: false,
    revokedAt: null,
    privateAmounts: {
      allocation: "24,000 cUSDT",
      vested: "16,880 cUSDT",
      available: "4,880 cUSDT",
      claimed: "12,000 cUSDT",
      unvested: "7,120 cUSDT",
      refundEntitlement: "0 cUSDT",
      refunded: "0 cUSDT",
    },
    note: "Backdated start. It has an immediate vesting estimate after funding verification.",
  },
  {
    id: "GR-0983",
    treasury: "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1",
    recipient: "0x2A49cdF700000000000000000000000000000447",
    token: tokens.unknown,
    start: 1704067200,
    end: 1735689600,
    cliff: null,
    revocable: false,
    revokedAt: null,
    privateAmounts: {
      allocation: "10,000 unknown token",
      vested: "10,000 unknown token",
      available: "0 unknown token",
      claimed: "10,000 unknown token",
      unvested: "0 unknown token",
      refundEntitlement: "0 unknown token",
      refunded: "0 unknown token",
    },
    note: "Completed grant with an unconfigured token. The address remains discoverable.",
  },
  {
    id: "GR-0971",
    treasury: "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1",
    recipient: "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4",
    token: tokens.cUsdc,
    start: 1711929600,
    end: 1775001600,
    cliff: 1743465600,
    revocable: true,
    revokedAt: 1756684800,
    privateAmounts: {
      allocation: "36,000 cUSDC",
      vested: "24,000 cUSDC",
      available: "8,000 cUSDC",
      claimed: "16,000 cUSDC",
      unvested: "12,000 cUSDC",
      refundEntitlement: "12,000 cUSDC",
      refunded: "0 cUSDC",
    },
    note: "Vesting stopped. The recipient can still claim vested tokens and the treasury can retry the refund.",
  },
];

export const zeroFundedAttempt = {
  id: "Attempt 08",
  recipient: "0x0a731a8900000000000000000000000000008412",
  token: tokens.cUsdc,
  result: "Zero funded",
};

export function isPrototypeVariant(value: string | string[] | null | undefined): value is PrototypeVariant {
  return typeof value === "string" && prototypeVariants.includes(value as PrototypeVariant);
}

export function variantName(variant: PrototypeVariant): string {
  return {
    A: "Grant workbench",
    B: "Lifecycle sequence",
    C: "Action inbox",
  }[variant];
}

export function grantForId(id: string): MockGrant {
  return mockGrants.find((grant) => grant.id === id) ?? mockGrants[0];
}

export function grantsForWorkspace(workspace: PrototypeWorkspace): MockGrant[] {
  return workspace === "dao"
    ? mockGrants.filter((grant) => grant.treasury === mockGrants[0].treasury)
    : mockGrants.filter((grant) => grant.recipient === mockGrants[0].recipient);
}
