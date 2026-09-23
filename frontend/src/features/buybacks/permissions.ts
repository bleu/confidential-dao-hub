export type WalletAccess = {
  address?: string;
  chainId?: number;
  expectedChainId: number;
};

type OwnerAccess = WalletAccess & {
  owner?: string;
};

export function sameAddress(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

export function isOnExpectedChain({ chainId, expectedChainId }: WalletAccess) {
  return chainId === expectedChainId;
}

export function walletActionReason(access: WalletAccess) {
  if (!access.address) return "Connect wallet";
  if (!isOnExpectedChain(access)) return "Switch to Sepolia";
  return undefined;
}

export function isContractOwner(access: OwnerAccess) {
  return (
    !walletActionReason(access) && sameAddress(access.address, access.owner)
  );
}

export function ownerActionReason(access: OwnerAccess, label: string) {
  return walletActionReason(access) ??
    (isContractOwner(access) ? undefined : `${label} owner only`);
}

export function canRollEpoch(
  access: OwnerAccess & { windowExpired: boolean },
) {
  return !walletActionReason(access) &&
    (isContractOwner(access) || access.windowExpired);
}

export function rollEpochReason(
  access: OwnerAccess & { windowExpired: boolean },
) {
  return (
    walletActionReason(access) ??
    (isContractOwner(access) || access.windowExpired
      ? undefined
      : "Wait for window expiry")
  );
}

export function isDisclosureEligible({
  closedAt,
  delaySeconds,
  now,
  disclosed,
}: {
  closedAt: bigint;
  delaySeconds: number;
  now: number;
  disclosed: boolean;
}) {
  return (
    !disclosed &&
    closedAt > 0n &&
    now >= Number(closedAt) + delaySeconds
  );
}
