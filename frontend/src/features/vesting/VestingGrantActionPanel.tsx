"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";

import { type SignTypedDataFn } from "../../lib/decryption-client";
import { useDecryption } from "../../lib/decryption-context";
import { useTx } from "../../lib/useTx";

import { VESTING_CHAIN_ID, VESTING_CONTRACT, vestingAbi } from "./contracts";
import { grantActionFor, normalizeGrant, type PrivateGrantAmounts, type PublicGrant, type VestingGrantRead } from "./data";
import { runGrantAction, retryGrantActionVerification, type GrantAction, type GrantActionState } from "./grantActions";
import { decryptPrivateGrantAmounts } from "./privateAccounting";
import type { VestingWorkspace } from "./Vesting";

const button = "rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300";
const disabledButton = "cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500";

export function VestingGrantActionPanel({
  workspace,
  grant,
  amounts,
  refreshPrivateAccounting,
}: {
  workspace: VestingWorkspace;
  grant: PublicGrant;
  amounts: PrivateGrantAmounts | undefined;
  refreshPrivateAccounting: () => Promise<void>;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: VESTING_CHAIN_ID });
  const decryption = useDecryption();
  const { sendWithReceipt, pending } = useTx();
  const [actionState, setActionState] = useState<GrantActionState>();
  const version = useRef(0);
  const context = useRef({ address, chainId, decryption });
  context.current = { address, chainId, decryption };
  const action = grantActionFor(workspace, grant, address, amounts);

  useEffect(() => {
    version.current++;
    setActionState(undefined);
  }, [address, chainId, decryption, grant.id]);

  if (!action) return null;

  async function submit(nextAction: GrantAction) {
    if (!publicClient || !address || !amounts) return;
    const operation = ++version.current;
    const wallet = address;
    const decryptionClient = decryption;
    const current = () =>
      version.current === operation &&
      context.current.address === wallet &&
      context.current.chainId === VESTING_CHAIN_ID &&
      context.current.decryption === decryptionClient;
    const report = (nextState: GrantActionState) => {
      if (current()) setActionState(nextState);
    };
    const readGrant = async (grantId: bigint) =>
      (await publicClient.readContract({
        address: VESTING_CONTRACT,
        abi: vestingAbi,
        functionName: "getGrant",
        args: [grantId],
      })) as unknown as VestingGrantRead;
    const adapters = {
      current,
      submit: async (actionToSubmit: GrantAction, grantId: bigint, onSubmitted: (hash: `0x${string}`) => void) => {
        const transaction = await sendWithReceipt(
          `vesting-${actionToSubmit}`,
          {
            address: VESTING_CONTRACT,
            abi: vestingAbi,
            functionName:
              actionToSubmit === "claim"
                ? "claim"
                : actionToSubmit === "revoke"
                  ? "revoke"
                  : "retryRefund",
            args: [grantId],
          },
          onSubmitted,
        );
        if (!transaction.ok) throw new Error(transaction.message);
        return transaction.receipt;
      },
      readGrant,
      decryptAmounts: async (read: VestingGrantRead) =>
        decryptPrivateGrantAmounts(
          normalizeGrant(grant.id, read),
          VESTING_CONTRACT,
          decryptionClient,
          signTypedDataAsync as unknown as SignTypedDataFn,
        ),
    };
    const result = await runGrantAction(nextAction, grant.id, amounts, adapters, report);
    if (current() && result.state !== "stale") await refreshPrivateAccounting();
  }

  async function retryVerification() {
    if (!actionState || actionState.state !== "retryable-decryption-error" || !publicClient || !address || !amounts) return;
    const operation = ++version.current;
    const wallet = address;
    const decryptionClient = decryption;
    const current = () =>
      version.current === operation &&
      context.current.address === wallet &&
      context.current.chainId === VESTING_CHAIN_ID &&
      context.current.decryption === decryptionClient;
    const report = (nextState: GrantActionState) => {
      if (current()) setActionState(nextState);
    };
    const readGrant = async (grantId: bigint) =>
      (await publicClient.readContract({
        address: VESTING_CONTRACT,
        abi: vestingAbi,
        functionName: "getGrant",
        args: [grantId],
      })) as unknown as VestingGrantRead;
    const result = await retryGrantActionVerification(actionState.action, grant.id, amounts, {
      current,
      submit: async () => { throw new Error("A private check does not submit a transaction."); },
      readGrant,
      decryptAmounts: async (read) => decryptPrivateGrantAmounts(
        normalizeGrant(grant.id, read),
        VESTING_CONTRACT,
        decryptionClient,
        signTypedDataAsync as unknown as SignTypedDataFn,
      ),
    }, report);
    if (current() && result.state !== "stale") await refreshPrivateAccounting();
  }

  const isChecking = actionState?.state === "transaction-pending" || actionState?.state === "mined-awaiting-private-check";
  const isRetryable = actionState?.state === "retryable-decryption-error";
  const label = isRetryable
    ? "Retry private check"
    : isChecking
      ? actionState.state === "transaction-pending" ? "Transaction pending..." : "Verifying privately..."
      : action === "claim" ? "Claim available" : action === "revoke" ? "Revoke grant" : "Retry refund";
  const onClick = isRetryable ? retryVerification : () => submit(action);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{workspace === "dao" ? "Treasury action" : "Recipient action"}</p>
      <h2 className="mt-2 text-xl text-zinc-100">{action === "claim" ? "Claim available" : action === "revoke" ? "Revoke grant" : "Refund progress"}</h2>
      {action === "revoke" && <p className="mt-3 text-sm leading-6 text-zinc-400">Vested but unclaimed tokens remain claimable. The unvested refund is an estimate until execution.</p>}
      {action === "claim" && <p className="mt-3 text-sm leading-6 text-zinc-400">Availability is an estimate. The execution-time amount controls the claim.</p>}
      {action === "retry-refund" && <p className="mt-3 text-sm leading-6 text-zinc-400">Retry only transfers the outstanding refund. Vesting stays stopped.</p>}
      {!amounts && <p className="mt-3 text-sm leading-6 text-zinc-400">Decrypt private values before this action so the result can be verified.</p>}
      <ActionMessage state={actionState} />
      <button type="button" disabled={!amounts || pending !== null || isChecking} onClick={onClick} className={`mt-4 ${amounts ? button : disabledButton}`}>{label}</button>
    </section>
  );
}

function ActionMessage({ state }: { state: GrantActionState | undefined }) {
  if (!state) return null;
  if (state.state === "verified-paid") return <p className="mt-3 text-sm leading-6 text-emerald-200" role="status">Private accounting confirmed a nonzero payment.</p>;
  if (state.state === "verified-revoked") return <p className="mt-3 text-sm leading-6 text-emerald-200" role="status">Vesting stopped. Private accounting confirmed refund progress. {state.outstandingRefund > 0n ? "A refund remains outstanding." : "The refund is complete."}</p>;
  if (state.state === "verified-zero-transfer") return <p className="mt-3 text-sm leading-6 text-amber-200" role="status">The transaction mined, but private accounting confirmed no tokens moved. {state.action === "claim" ? "Claim entitlement remains available." : "The refund remains outstanding."}</p>;
  if (state.state === "retryable-decryption-error") return <p className="mt-3 text-sm leading-6 text-amber-200" role="status">The transaction mined, but private verification is unavailable. Retry the private check before treating it as a payment.</p>;
  if (state.state === "transaction-error") return <p className="mt-3 text-sm leading-6 text-red-300" role="status">{state.message}</p>;
  return null;
}
