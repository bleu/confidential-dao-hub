"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { EncryptedValue } from "@/components/EncryptedValue";
import { CONTRACTS, oracleAbi, vaultAbi } from "@/config/contracts";
import { encryptAmount } from "@/lib/fhevm";
import {
  formatPrice,
  formatTimestamp,
  parseAmount,
  parsePrice,
} from "@/lib/format";
import { useEpochs } from "@/lib/useEpochs";
import { useTx } from "@/lib/useTx";

export function TreasuryPanel() {
  const { address } = useAccount();
  const { send, pending, error } = useTx();
  const [budgetInput, setBudgetInput] = useState("1000");
  const [topUpInput, setTopUpInput] = useState("500");
  const [priceInput, setPriceInput] = useState("");

  const { data: owner } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "owner",
  });
  const { data: hasOpen } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "hasOpenEpoch",
  });
  const { data: currentId } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "currentEpochId",
  });
  const { data: oraclePrice } = useReadContract({
    address: CONTRACTS.oracle,
    abi: oracleAbi,
    functionName: "price",
  });
  const { epochs } = useEpochs();

  const isOwner =
    !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const current =
    hasOpen && currentId !== undefined
      ? epochs.find((e) => e.id === currentId)
      : undefined;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const windowExpired = !!current && current.epoch.endsAt <= nowSec;

  const openPool = () =>
    send("open", async () => {
      const budget = parseAmount(budgetInput);
      const enc = await encryptAmount(CONTRACTS.vault, address!, budget);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "openEpoch",
        args: [enc.handle, enc.proof],
      };
    });

  const topUp = () =>
    send("topup", async () => {
      const amount = parseAmount(topUpInput);
      const enc = await encryptAmount(CONTRACTS.vault, address!, amount);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "topUp",
        args: [enc.handle, enc.proof],
      };
    });

  const setPrice = () =>
    send("price", () =>
      Promise.resolve({
        address: CONTRACTS.oracle,
        abi: oracleAbi,
        functionName: "setPrice" as const,
        args: [parsePrice(priceInput)] as const,
      }),
    );

  return (
    <div className="space-y-6">
      {!isOwner && (
        <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-500">
          Treasury actions are owner-gated (
          {owner ? `${owner.slice(0, 10)}…` : "…"}). You can view this panel but
          transactions will revert unless you hold the treasury key.
        </p>
      )}

      {current ? (
        <section className="rounded-lg border border-yellow-900/60 bg-yellow-950/10 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm uppercase tracking-widest text-yellow-400">
              window #{current.id.toString()} · live
            </h2>
            <span className="text-xs text-zinc-500">
              {windowExpired
                ? "ended — awaiting settle"
                : `settles ${formatTimestamp(current.epoch.endsAt)}`}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="mb-1 text-zinc-500">Budget</dt>
              <dd>
                <EncryptedValue
                  handle={current.epoch.budget}
                  contractAddress={CONTRACTS.vault}
                  unit="cTOKEN"
                />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Remaining</dt>
              <dd>
                <EncryptedValue
                  handle={current.epoch.remaining}
                  contractAddress={CONTRACTS.vault}
                  unit="cTOKEN"
                />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Total filled</dt>
              <dd>
                <EncryptedValue
                  handle={current.epoch.totalFilled}
                  contractAddress={CONTRACTS.vault}
                  unit="cTOKEN"
                />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-zinc-500">Oracle price (public)</dt>
              <dd className="font-mono text-zinc-200">
                {oraclePrice !== undefined ? formatPrice(oraclePrice) : "…"}{" "}
                cUSDT / cTOKEN
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-500">
              top up budget (cTOKEN, encrypted)
              <input
                value={topUpInput}
                onChange={(e) => setTopUpInput(e.target.value)}
                className="mt-1 block w-36 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-yellow-300 outline-none focus:border-yellow-600"
              />
            </label>
            <button
              onClick={topUp}
              disabled={!isOwner || pending !== null}
              className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-xs text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-40"
            >
              {pending === "topup"
                ? "encrypting + adding…"
                : "encrypt & top up"}
            </button>
            <button
              onClick={() =>
                send("roll", {
                  address: CONTRACTS.vault,
                  abi: vaultAbi,
                  functionName: "rollEpoch",
                })
              }
              disabled={(!isOwner && !windowExpired) || pending !== null}
              className="rounded border border-red-900 bg-red-950/30 px-4 py-1.5 font-mono text-xs text-red-300 transition-colors hover:bg-red-900/30 disabled:opacity-40"
            >
              {pending === "roll" ? "settling…" : "settle window now"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Settling snapshots the oracle price for this window and rolls the
            unspent budget into the next one. A top-up of 0 is indistinguishable
            from a real one — top-ups leak nothing.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-zinc-400">
            open the pool
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500">
                Initial budget (cTOKEN, encrypted on-chain)
              </span>
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-44 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-yellow-300 outline-none focus:border-yellow-600"
              />
            </label>
            <button
              onClick={openPool}
              disabled={!isOwner || pending !== null}
              className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-sm text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-40"
            >
              {pending === "open" ? "encrypting + opening…" : "encrypt & open"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Once opened, the pool stays open: windows settle at the oracle price
            and roll automatically, carrying unspent budget forward. Fund the
            vault with cUSDT before opening (payouts are best-effort).
          </p>
        </section>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="mb-3 font-mono text-sm uppercase tracking-widest text-zinc-400">
          price oracle (mock)
        </h2>
        <p className="mb-3 text-xs text-zinc-600">
          Windows settle at this price. PoC stand-in for a real feed — the
          treasury moves it to simulate the market.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <span className="font-mono text-sm text-zinc-200">
            current:{" "}
            {oraclePrice !== undefined ? formatPrice(oraclePrice) : "…"} cUSDT /
            cTOKEN
          </span>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="2.10"
            className="w-28 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-yellow-600"
          />
          <button
            onClick={setPrice}
            disabled={!isOwner || pending !== null || !priceInput}
            className="rounded border border-zinc-600 px-3 py-1.5 font-mono text-xs text-zinc-300 hover:border-zinc-400 disabled:opacity-40"
          >
            {pending === "price" ? "setting…" : "set price"}
          </button>
        </div>
      </section>

      {error && (
        <p className="break-all rounded border border-red-900 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
