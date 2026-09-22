"use client";

import { useState, useSyncExternalStore } from "react";
import { useAccount, useSignTypedData } from "wagmi";

import type { SignTypedDataFn } from "@/lib/decryption-client";
import { useDecryption } from "@/lib/decryption-context";
import { formatAmount } from "@/lib/format";

/**
 * Renders an encrypted euint64 handle as a lock badge with a "decrypt" action.
 * Never renders as 0 — an undecrypted value is always shown locked.
 */
export function EncryptedValue({
  handle,
  contractAddress,
  unit,
  scale = 1n,
  format,
}: {
  handle: string | undefined;
  contractAddress: string;
  unit?: string;
  /** Optional plaintext multiplier applied to the decrypted value. */
  scale?: bigint;
  /** Optional custom renderer for the decrypted value (defaults to 6dp amount + unit). */
  format?: (value: bigint) => string;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const decryption = useDecryption();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Re-render whenever any decryption lands (payout cells depend on siblings).
  useSyncExternalStore(
    decryption.subscribe,
    decryption.getVersion,
    decryption.getVersion,
  );

  if (!handle) return <span className="text-zinc-600">—</span>;

  const cached = decryption.getCachedDecryption(handle, contractAddress);
  if (cached !== undefined) {
    return (
      <span className="font-mono text-yellow-300">
        {format ? (
          format(cached)
        ) : (
          <>
            {formatAmount(cached * scale)}{" "}
            <span className="text-zinc-500">{unit}</span>
          </>
        )}
      </span>
    );
  }

  const decrypt = async () => {
    if (!address) return;
    setBusy(true);
    setFailed(false);
    try {
      await decryption.userDecrypt(
        [{ handle, contractAddress }],
        signTypedDataAsync as unknown as SignTypedDataFn,
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={decrypt}
      disabled={busy || !address}
      className="group inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400 transition-colors hover:border-yellow-600 hover:text-yellow-300 disabled:cursor-default disabled:opacity-60"
      title={
        address ? "Decrypt with your wallet key" : "Connect a wallet to decrypt"
      }
    >
      <span aria-hidden>{busy ? "◌" : "🔒"}</span>
      {busy ? "decrypting…" : failed ? "retry decrypt" : "encrypted · decrypt"}
    </button>
  );
}
