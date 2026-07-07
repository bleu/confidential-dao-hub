"use client";

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

  const send = useCallback(
    async (
      label: string,
      params: WriteParams | (() => Promise<WriteParams>),
    ) => {
      setPending(label);
      setError(null);
      try {
        const resolved = typeof params === "function" ? await params() : params;
        const hash = await writeContractAsync(resolved);
        await publicClient!.waitForTransactionReceipt({ hash });
        await queryClient.invalidateQueries();
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Surface the useful part of viem's verbose errors.
        setError(message.split("\n")[0].slice(0, 200));
        return false;
      } finally {
        setPending(null);
      }
    },
    [writeContractAsync, publicClient, queryClient],
  );

  return { send, pending, error, setError };
}
