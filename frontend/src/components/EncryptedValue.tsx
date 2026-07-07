"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";

import { getCachedDecryption, userDecrypt, type SignTypedDataFn } from "@/lib/fhevm";
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
}: {
  handle: string | undefined;
  contractAddress: string;
  unit: string;
  /** Optional plaintext multiplier applied to the decrypted value (e.g. price for payout preview). */
  scale?: bigint;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Re-render trigger after decryption resolves.
  const [, bump] = useState(0);

  if (!handle) return <span className="text-zinc-600">—</span>;

  const cached = getCachedDecryption(handle);
  if (cached !== undefined) {
    return (
      <span className="font-mono text-yellow-300">
        {formatAmount(cached * scale)} <span className="text-zinc-500">{unit}</span>
      </span>
    );
  }

  const decrypt = async () => {
    if (!address) return;
    setBusy(true);
    setFailed(false);
    try {
      await userDecrypt(
        [{ handle, contractAddress }],
        address,
        signTypedDataAsync as unknown as SignTypedDataFn,
      );
      bump((n) => n + 1);
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
      title={address ? "Decrypt with your wallet key" : "Connect a wallet to decrypt"}
    >
      <span aria-hidden>{busy ? "◌" : "🔒"}</span>
      {busy ? "decrypting…" : failed ? "retry decrypt" : "encrypted · decrypt"}
    </button>
  );
}
