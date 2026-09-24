export type VestingWorkspace = "community" | "dao";
export type GrantStatus = "active" | "stopped";

export type VestingGrant = {
  id: string;
  treasury: string;
  recipient: string;
  token: string;
  start: string;
  end: string;
  cliff: string | null;
  revocable: boolean;
  status: GrantStatus;
  revokedAt: string | null;
  privateAccounting: {
    allocation: string;
    vested: string;
    available: string;
    claimed: string;
    unvested: string;
    outstandingRefund?: string;
  };
};

const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const recipient = "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4";

export const vestingGrants: readonly VestingGrant[] = [
  {
    id: "GR-1048",
    treasury,
    recipient,
    token: "cUSDC",
    start: "Jan 1, 2025",
    end: "Jan 1, 2027",
    cliff: "Jan 1, 2026",
    revocable: true,
    status: "active",
    revokedAt: null,
    privateAccounting: {
      allocation: "48,000 cUSDC",
      vested: "18,240 cUSDC",
      available: "6,240 cUSDC",
      claimed: "12,000 cUSDC",
      unvested: "29,760 cUSDC",
    },
  },
  {
    id: "GR-1021",
    treasury,
    recipient,
    token: "cUSDT",
    start: "Aug 1, 2024",
    end: "Aug 1, 2026",
    cliff: "Jan 1, 2025",
    revocable: false,
    status: "active",
    revokedAt: null,
    privateAccounting: {
      allocation: "24,000 cUSDT",
      vested: "16,880 cUSDT",
      available: "4,880 cUSDT",
      claimed: "12,000 cUSDT",
      unvested: "7,120 cUSDT",
    },
  },
  {
    id: "GR-0888",
    treasury: "0x2A49cdF700000000000000000000000000000447",
    recipient,
    token: "cUSDT",
    start: "May 1, 2025",
    end: "May 1, 2027",
    cliff: null,
    revocable: false,
    status: "active",
    revokedAt: null,
    privateAccounting: {
      allocation: "18,000 cUSDT",
      vested: "6,000 cUSDT",
      available: "2,000 cUSDT",
      claimed: "4,000 cUSDT",
      unvested: "12,000 cUSDT",
    },
  },
  {
    id: "GR-0971",
    treasury,
    recipient,
    token: "cUSDC",
    start: "Apr 1, 2024",
    end: "Apr 1, 2026",
    cliff: "Apr 1, 2025",
    revocable: true,
    status: "stopped",
    revokedAt: "Sep 1, 2025",
    privateAccounting: {
      allocation: "36,000 cUSDC",
      vested: "24,000 cUSDC",
      available: "8,000 cUSDC",
      claimed: "16,000 cUSDC",
      unvested: "12,000 cUSDC",
      outstandingRefund: "12,000 cUSDC",
    },
  },
];

export function grantsForWorkspace(workspace: VestingWorkspace): readonly VestingGrant[] {
  return workspace === "dao" ? vestingGrants.filter((grant) => grant.treasury === treasury) : vestingGrants.filter((grant) => grant.recipient === recipient);
}

export function grantStatusLabel(status: GrantStatus): string {
  return status === "active" ? "Active" : "Stopped";
}
