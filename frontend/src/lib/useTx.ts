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
      onSubmitted?: (hash: Hex) => void,
    ) => {
      setPending(label);
      setError(null);
      let hash: Hex | undefined;
      let receiptObserved = false;
      try {
        const resolved = typeof params === "function" ? await params() : params;
        hash = await writeContractAsync(resolved);
        onSubmitted?.(hash);
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });
        receiptObserved = true;
        if (receipt.status !== "success") throw new Error("Transaction reverted.");
        await queryClient.invalidateQueries();
        return { ok: true as const, receipt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const conciseMessage = message.split("\n")[0].slice(0, 200);
        const displayMessage = hash && !receiptObserved
          ? `Transaction status is unknown. Check ${hash} before sending again.`
          : conciseMessage;
        setError(displayMessage);
        return { ok: false as const, message: displayMessage };
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
    ) => (await sendWithReceipt(label, params)).ok,
    [sendWithReceipt],
  );

  return { send, sendWithReceipt, pending, error, setError };
}
