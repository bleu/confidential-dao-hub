"use client";

import { useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

import { resetSession } from "@/lib/fhevm";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // A new account must sign its own decryption session.
  useEffect(() => {
    resetSession();
  }, [address]);

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isPending || connectors.length === 0}
        className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-sm text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-50"
      >
        {isPending ? "connecting…" : "connect wallet"}
      </button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: sepolia.id })}
        className="rounded border border-amber-700 bg-amber-950/40 px-4 py-1.5 font-mono text-sm text-amber-300 hover:bg-amber-900/40"
      >
        switch to Sepolia
      </button>
    );
  }

  return (
    <button
      onClick={() => disconnect()}
      title="Disconnect"
      className="rounded border border-zinc-700 bg-zinc-900 px-4 py-1.5 font-mono text-sm text-zinc-300 transition-colors hover:border-zinc-500"
    >
      {shortAddress(address!)}
    </button>
  );
}
