import { normalizeGrant } from "../../src/features/vesting/data.ts";

export const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
export const recipient = "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4";
export const configuredToken = "0x0a73c1167cE82040dE1a1BEf47d4a32e8431A9D4";
export const unconfiguredToken = "0x4b73c1167cE82040dE1a1BEf47d4a32e8431A9D4";

export function contractGrantRead({
  grantTreasury = treasury,
  grantRecipient = recipient,
  token = configuredToken,
} = {}) {
  return {
    treasury: grantTreasury,
    recipient: grantRecipient,
    token,
    start: 1_700_000_000n,
    end: 1_800_000_000n,
    cliff: 0n,
    revocable: true,
    revoked: false,
    revokedAt: 0n,
    refundEntitlement: `0x${"01".repeat(32)}`,
    refunded: `0x${"02".repeat(32)}`,
    allocation: `0x${"03".repeat(32)}`,
    claimed: `0x${"04".repeat(32)}`,
  };
}

export function contractGrant(id, options = {}) {
  return normalizeGrant(id, contractGrantRead(options));
}

export const treasuryOnlyGrant = contractGrant(1n);
export const recipientOnlyGrant = contractGrant(2n, { grantTreasury: recipient, grantRecipient: treasury });
export const dualRoleGrant = contractGrant(3n, { grantRecipient: treasury });
export const unconfiguredTokenGrant = contractGrant(4n, { token: unconfiguredToken });
