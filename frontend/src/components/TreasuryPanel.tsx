"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { EncryptedValue } from "@/components/EncryptedValue";
import { CONTRACTS, vaultAbi } from "@/config/contracts";
import { encryptAmount } from "@/lib/fhevm";
import { formatTimestamp, parseAmount } from "@/lib/format";
import { useEpochs } from "@/lib/useEpochs";
import { useTx } from "@/lib/useTx";

export function TreasuryPanel() {
  const { address } = useAccount();
  const { send, pending, error } = useTx();
  const [budgetInput, setBudgetInput] = useState("1000");
  const [priceInput, setPriceInput] = useState("2");

  const { data: owner } = useReadContract({ address: CONTRACTS.vault, abi: vaultAbi, functionName: "owner" });
  const { data: hasOpen } = useReadContract({ address: CONTRACTS.vault, abi: vaultAbi, functionName: "hasOpenEpoch" });
  const { data: currentId } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "currentEpochId",
  });
  const { epochs } = useEpochs();

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const current = hasOpen && currentId !== undefined ? epochs.find((e) => e.id === currentId) : undefined;

  const openEpoch = () =>
    send("open", async () => {
      const budget = parseAmount(budgetInput);
      const price = BigInt(priceInput);
      if (price <= 0n || price > 1000n) throw new Error("Price must be between 1 and 1000");
      const enc = await encryptAmount(CONTRACTS.vault, address!, budget);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "openEpoch",
        args: [enc.handle, enc.proof, price],
      };
    });

  return (
    <div className="space-y-6">
      {!isOwner && (
        <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-500">
          Treasury actions are owner-gated ({owner ? `${owner.slice(0, 10)}…` : "…"}). You can view this panel but
          transactions will revert unless you hold the treasury key.
        </p>
      )}

      {current ? (
        <section className="rounded-lg border border-yellow-900/60 bg-yellow-950/10 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm uppercase tracking-widest text-yellow-400">
              epoch #{current.id.toString()} · live
            </h2>
            <span className="text-xs text-zinc-500">opened {formatTimestamp(current.epoch.openedAt)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="mb-1 text-zinc-500">Budget</dt>
              <dd>
                <EncryptedValue handle={current.epoch.budget} contractAddress={CONTRACTS.vault} unit="cTOKEN" />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Remaining</dt>
              <dd>
                <EncryptedValue handle={current.epoch.remaining} contractAddress={CONTRACTS.vault} unit="cTOKEN" />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Total filled</dt>
              <dd>
                <EncryptedValue handle={current.epoch.totalFilled} contractAddress={CONTRACTS.vault} unit="cTOKEN" />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Price (public)</dt>
              <dd className="font-mono text-zinc-200">{current.epoch.price.toString()} cUSDT / cTOKEN</dd>
            </div>
          </dl>
          <button
            onClick={() => send("close", { address: CONTRACTS.vault, abi: vaultAbi, functionName: "closeEpoch" })}
            disabled={!isOwner || pending !== null}
            className="mt-5 rounded border border-red-900 bg-red-950/30 px-4 py-1.5 font-mono text-sm text-red-300 transition-colors hover:bg-red-900/30 disabled:opacity-40"
          >
            {pending === "close" ? "closing…" : "close epoch"}
          </button>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-zinc-400">open new epoch</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500">Budget (cTOKEN, encrypted on-chain)</span>
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-44 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-yellow-300 outline-none focus:border-yellow-600"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500">Price (cUSDT per cTOKEN, public)</span>
              <input
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-32 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-zinc-200 outline-none focus:border-yellow-600"
              />
            </label>
            <button
              onClick={openEpoch}
              disabled={!isOwner || pending !== null}
              className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-sm text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-40"
            >
              {pending === "open" ? "encrypting + opening…" : "encrypt & open"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            The budget is encrypted in your browser and submitted as a ciphertext — it never appears on-chain in
            plaintext.
          </p>
          <p className="mt-3 text-xs text-zinc-600">
            Fund the vault with cUSDT before opening (payouts are best-effort against vault balance).
          </p>
        </section>
      )}

      {error && <p className="break-all rounded border border-red-900 bg-red-950/20 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
