import type { Hex } from "viem";

import type { PrivateGrantAmounts } from "./data";

export type GrantAction = "claim" | "revoke" | "retry-refund";

export type GrantActionState =
  | { state: "transaction-pending"; action: GrantAction; hash: Hex }
  | { state: "mined-awaiting-private-check"; action: GrantAction; grantId: bigint }
  | { state: "verified-paid"; action: "claim"; amount: bigint }
  | { state: "verified-revoked"; refunded: bigint; outstandingRefund: bigint }
  | { state: "verified-zero-transfer"; action: "claim" | "retry-refund"; outstandingRefund?: bigint }
  | { state: "retryable-decryption-error"; action: GrantAction; grantId: bigint }
  | { state: "transaction-error"; message: string }
  | { state: "stale" };

export type GrantActionAdapters<Receipt, Grant> = {
  current: () => boolean;
  submit: (
    action: GrantAction,
    grantId: bigint,
    onSubmitted: (hash: Hex) => void,
  ) => Promise<Receipt>;
  readGrant: (grantId: bigint) => Promise<Grant>;
  decryptAmounts: (grant: Grant) => Promise<PrivateGrantAmounts>;
};

export async function runGrantAction<Receipt, Grant>(
  action: GrantAction,
  grantId: bigint,
  before: PrivateGrantAmounts,
  adapters: GrantActionAdapters<Receipt, Grant>,
  report: (state: GrantActionState) => void,
): Promise<GrantActionState> {
  try {
    await adapters.submit(action, grantId, (hash) =>
      report({ state: "transaction-pending", action, hash }),
    );
    if (!adapters.current()) return stale(report);

    report({ state: "mined-awaiting-private-check", action, grantId });
    return verifyGrantAction(action, grantId, before, adapters, report);
  } catch (error) {
    if (!adapters.current()) return stale(report);
    const result: GrantActionState = {
      state: "transaction-error",
      message: error instanceof Error ? error.message : String(error),
    };
    report(result);
    return result;
  }
}

export async function retryGrantActionVerification<Receipt, Grant>(
  action: GrantAction,
  grantId: bigint,
  before: PrivateGrantAmounts,
  adapters: GrantActionAdapters<Receipt, Grant>,
  report: (state: GrantActionState) => void,
): Promise<GrantActionState> {
  report({ state: "mined-awaiting-private-check", action, grantId });
  return verifyGrantAction(action, grantId, before, adapters, report);
}

async function verifyGrantAction<Receipt, Grant>(
  action: GrantAction,
  grantId: bigint,
  before: PrivateGrantAmounts,
  adapters: GrantActionAdapters<Receipt, Grant>,
  report: (state: GrantActionState) => void,
): Promise<GrantActionState> {
  try {
    const grant = await adapters.readGrant(grantId);
    if (!adapters.current()) return stale(report);
    const after = await adapters.decryptAmounts(grant);
    if (!adapters.current()) return stale(report);

    const result = actionResult(action, before, after);
    report(result);
    return result;
  } catch {
    if (!adapters.current()) return stale(report);
    const result: GrantActionState = { state: "retryable-decryption-error", action, grantId };
    report(result);
    return result;
  }
}

function actionResult(
  action: GrantAction,
  before: PrivateGrantAmounts,
  after: PrivateGrantAmounts,
): GrantActionState {
  if (action === "claim") {
    const amount = after.claimed - before.claimed;
    return amount > 0n
      ? { state: "verified-paid", action, amount }
      : { state: "verified-zero-transfer", action };
  }

  const refunded = after.refunded - before.refunded;
  const outstandingRefund = after.refundEntitlement - after.refunded;
  if (action === "revoke") {
    return { state: "verified-revoked", refunded, outstandingRefund };
  }

  return refunded > 0n
    ? { state: "verified-revoked", refunded, outstandingRefund }
    : { state: "verified-zero-transfer", action, outstandingRefund };
}

function stale(report: (state: GrantActionState) => void): GrantActionState {
  const result: GrantActionState = { state: "stale" };
  report(result);
  return result;
}
