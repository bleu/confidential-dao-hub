import type { Address, Hex } from "viem";

import type { CreateGrantRequest } from "./data";

export type GrantCreationState =
  | { state: "encrypting" }
  | { state: "transaction-pending"; hash: Hex }
  | { state: "mined-awaiting-private-check"; grantId: bigint }
  | { state: "funded"; grantId: bigint; allocation: bigint }
  | { state: "zero-funded"; grantId: bigint; allocation: 0n }
  | { state: "retryable-decryption-error"; grantId: bigint }
  | { state: "transaction-error"; message: string }
  | { state: "stale" };

export type GrantCreationAdapters<Receipt, Grant> = {
  vestingContract: Address;
  treasury: Address;
  current: () => boolean;
  encrypt: (contract: Address, wallet: Address, value: bigint) => Promise<{ handle: Hex; proof: Hex }>;
  submit: (
    args: CreateGrantRequest & { handle: Hex; proof: Hex },
    onSubmitted: (hash: Hex) => void,
  ) => Promise<Receipt>;
  grantIdFromReceipt: (receipt: Receipt) => bigint;
  readGrant: (id: bigint) => Promise<Grant>;
  decryptAllocation: (grant: Grant) => Promise<bigint>;
};

export async function createGrant<Receipt, Grant>(
  request: CreateGrantRequest,
  adapters: GrantCreationAdapters<Receipt, Grant>,
  report: (state: GrantCreationState) => void,
): Promise<GrantCreationState> {
  report({ state: "encrypting" });
  try {
    const encrypted = await adapters.encrypt(
      adapters.vestingContract,
      adapters.treasury,
      request.allocation,
    );
    if (!adapters.current()) return stale(report);

    const receipt = await adapters.submit(
      { ...request, ...encrypted },
      (hash) => report({ state: "transaction-pending", hash }),
    );
    if (!adapters.current()) return stale(report);

    const grantId = adapters.grantIdFromReceipt(receipt);
    report({ state: "mined-awaiting-private-check", grantId });
    return checkPrivateFunding(grantId, adapters, report);
  } catch (error) {
    if (!adapters.current()) return stale(report);
    const result: GrantCreationState = {
      state: "transaction-error",
      message: error instanceof Error ? error.message : String(error),
    };
    report(result);
    return result;
  }
}

export async function retryPrivateFundingCheck<Receipt, Grant>(
  grantId: bigint,
  adapters: GrantCreationAdapters<Receipt, Grant>,
  report: (state: GrantCreationState) => void,
): Promise<GrantCreationState> {
  report({ state: "mined-awaiting-private-check", grantId });
  return checkPrivateFunding(grantId, adapters, report);
}

async function checkPrivateFunding<Receipt, Grant>(
  grantId: bigint,
  adapters: GrantCreationAdapters<Receipt, Grant>,
  report: (state: GrantCreationState) => void,
): Promise<GrantCreationState> {
  try {
    const grant = await adapters.readGrant(grantId);
    if (!adapters.current()) return stale(report);
    const allocation = await adapters.decryptAllocation(grant);
    if (!adapters.current()) return stale(report);
    const result: GrantCreationState =
      allocation === 0n
        ? { state: "zero-funded", grantId, allocation: 0n }
        : { state: "funded", grantId, allocation };
    report(result);
    return result;
  } catch {
    if (!adapters.current()) return stale(report);
    const result: GrantCreationState = { state: "retryable-decryption-error", grantId };
    report(result);
    return result;
  }
}

function stale(report: (state: GrantCreationState) => void): GrantCreationState {
  const result: GrantCreationState = { state: "stale" };
  report(result);
  return result;
}
