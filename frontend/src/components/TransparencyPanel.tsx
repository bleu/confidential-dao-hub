"use client";

import { useState } from "react";

import { CONTRACTS, vaultAbi } from "@/config/contracts";
import { publicDecrypt } from "@/lib/fhevm";
import { formatAmount, formatTimestamp } from "@/lib/format";
import { useEpochs } from "@/lib/useEpochs";
import { useTx } from "@/lib/useTx";

const DISCLOSURE_DELAY = 300; // seconds, mirrors the contract constant

export function TransparencyPanel() {
  const { epochs } = useEpochs();
  const { send, pending, error, setError } = useTx();
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const finalize = (epochId: bigint, totalFilledHandle: string) =>
    send(`finalize-${epochId}`, async () => {
      const result = await publicDecrypt(totalFilledHandle).catch(() => {
        throw new Error("Public decryption not ready — run step 1 (request) first, then retry in ~30s.");
      });
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "finalizeDisclosure",
        args: [epochId, result.abiEncodedClearValues, result.decryptionProof],
      };
    });

  if (epochs.length === 0) {
    return <p className="text-sm text-zinc-500">No epochs yet.</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        Epoch totals stay encrypted while orders execute. {DISCLOSURE_DELAY / 60} minutes after an epoch closes,{" "}
        <span className="text-zinc-300">anyone</span> can trigger public disclosure of the total bought — the
        cleartext is verified on-chain against KMS signatures. Confidential during execution, accountable afterward.
      </p>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 font-mono text-xs uppercase text-zinc-600">
            <th className="pb-2 pr-4">epoch</th>
            <th className="pb-2 pr-4">price</th>
            <th className="pb-2 pr-4">opened</th>
            <th className="pb-2 pr-4">closed</th>
            <th className="pb-2 pr-4">total bought</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {epochs.map(({ id, epoch }) => {
            const eligible =
              !epoch.open && epoch.closedAt > 0n && now >= Number(epoch.closedAt) + DISCLOSURE_DELAY && !epoch.disclosed;
            const waiting = !epoch.open && epoch.closedAt > 0n && !eligible && !epoch.disclosed;
            return (
              <tr key={id.toString()} className="border-b border-zinc-900 align-top">
                <td className="py-3 pr-4 font-mono text-zinc-400">#{id.toString()}</td>
                <td className="py-3 pr-4 font-mono text-zinc-300">{epoch.price.toString()}</td>
                <td className="py-3 pr-4 text-zinc-500">{formatTimestamp(epoch.openedAt)}</td>
                <td className="py-3 pr-4 text-zinc-500">{epoch.open ? "live" : formatTimestamp(epoch.closedAt)}</td>
                <td className="py-3 pr-4">
                  {epoch.disclosed ? (
                    <span className="font-mono text-yellow-300">
                      {formatAmount(epoch.disclosedTotal)} <span className="text-zinc-500">cTOKEN</span>
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-zinc-500">🔒 encrypted</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {epoch.open ? (
                    <span className="font-mono text-xs text-zinc-600">epoch live</span>
                  ) : epoch.disclosed ? (
                    <span className="font-mono text-xs text-yellow-500">disclosed ✓</span>
                  ) : waiting ? (
                    <span className="font-mono text-xs text-zinc-600">delay pending…</span>
                  ) : eligible ? (
                    <span className="inline-flex gap-2">
                      <button
                        onClick={() => {
                          setError(null);
                          send(`request-${id}`, {
                            address: CONTRACTS.vault,
                            abi: vaultAbi,
                            functionName: "requestDisclosure",
                            args: [id],
                          });
                        }}
                        disabled={pending !== null}
                        className="rounded border border-zinc-600 px-3 py-1 font-mono text-xs text-zinc-300 hover:border-zinc-400 disabled:opacity-40"
                      >
                        {pending === `request-${id}` ? "requesting…" : "1 · request"}
                      </button>
                      <button
                        onClick={() => finalize(id, epoch.totalFilled)}
                        disabled={pending !== null}
                        className="rounded border border-yellow-600 bg-yellow-950/40 px-3 py-1 font-mono text-xs text-yellow-300 hover:bg-yellow-900/40 disabled:opacity-40"
                      >
                        {pending === `finalize-${id}` ? "decrypting…" : "2 · publish total"}
                      </button>
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {error && <p className="break-all rounded border border-red-900 bg-red-950/20 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
