"use client";

import type { Hex } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";

type WriteParams = Parameters<
  ReturnType<typeof useWriteContract>["writeContractAsync"]
>[0];

/**
 * Sends a contract write, waits for the receipt, then invalidates all reads.
 * Tracks a single in-flight label so panels can disable buttons + show status.
 */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendWithReceipt = useCallback(
    async (
      label: string,
      params: WriteParams | (() => Promise<WriteParams>),
    ) => {
      setPending(label);
      setError(null);
      let hash: Hex | undefined;
      let receiptObserved = false;
      try {
        const resolved = typeof params === "function" ? await params() : params;
        hash = await writeContractAsync(resolved);
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });
        receiptObserved = true;
        if (receipt.status !== "success")
          throw new Error("Transaction reverted.");
        await queryClient.invalidateQueries();
        return { hash, receipt };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(hash && !receiptObserved ? `Transaction status is unknown. Check ${hash} before sending again.` : message.split("\n")[0].slice(0, 200));
        return hash && !receiptObserved ? { hash } : undefined;
      } finally {
        setPending(null);
      }
    },
    [writeContractAsync, publicClient, queryClient],
  );

  const send = useCallback(
    async (
      label: string,
      params: WriteParams | (() => Promise<WriteParams>),
    ) => Boolean((await sendWithReceipt(label, params))?.receipt),
    [sendWithReceipt],
  );

  return { send, sendWithReceipt, pending, error, setError };
}
