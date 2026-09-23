"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { EncryptedValue } from "@/components/EncryptedValue";
import { CONTRACTS, CHAIN_ID, oracleAbi, vaultAbi } from "@/features/buybacks/contracts";
import {
  isContractOwner,
  ownerActionReason,
  rollEpochReason,
} from "@/features/buybacks/permissions";
import { encryptAmount } from "@/lib/fhevm";
import {
  formatPrice,
  formatTimestamp,
  parseAmount,
  parsePrice,
} from "@/lib/format";
import { useEpochs } from "@/features/buybacks/useEpochs";
import { useTx } from "@/lib/useTx";

export function TreasuryPanel() {
  const { address, chainId } = useAccount();
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
  const { data: oracleOwner } = useReadContract({
    address: CONTRACTS.oracle,
    abi: oracleAbi,
    functionName: "owner",
  });
  const { data: oraclePrice } = useReadContract({
    address: CONTRACTS.oracle,
    abi: oracleAbi,
    functionName: "price",
  });
  const { epochs } = useEpochs();

  const vaultAccess = { address, chainId, expectedChainId: CHAIN_ID, owner };
  const oracleAccess = {
    address,
    chainId,
    expectedChainId: CHAIN_ID,
    owner: oracleOwner,
  };
  const isVaultOwner = isContractOwner(vaultAccess);
  const current =
    hasOpen && currentId !== undefined
      ? epochs.find((e) => e.id === currentId)
      : undefined;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const windowExpired = !!current && current.epoch.endsAt <= nowSec;
  const vaultActionReason = ownerActionReason(vaultAccess, "Vault");
  const oracleActionReason = ownerActionReason(oracleAccess, "Oracle");
  const priceActionReason =
    oracleActionReason ?? (!priceInput ? "Enter price" : undefined);
  const rollReason = rollEpochReason({ ...vaultAccess, windowExpired });

  const openPool = () => {
    if (vaultActionReason) return;
    return send("open", async () => {
      const budget = parseAmount(budgetInput);
      const enc = await encryptAmount(CONTRACTS.vault, address!, budget);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "openEpoch",
        args: [enc.handle, enc.proof],
      };
    });
  };

  const topUp = () => {
    if (vaultActionReason) return;
    return send("topup", async () => {
      const amount = parseAmount(topUpInput);
      const enc = await encryptAmount(CONTRACTS.vault, address!, amount);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "topUp",
        args: [enc.handle, enc.proof],
      };
    });
  };

  const setPrice = () => {
    if (priceActionReason) return;
    return send("price", () =>
      Promise.resolve({
        address: CONTRACTS.oracle,
        abi: oracleAbi,
        functionName: "setPrice" as const,
        args: [parsePrice(priceInput)] as const,
      }),
    );
  };

  const rollEpoch = () => {
    if (rollReason) return;
    return send("roll", {
      address: CONTRACTS.vault,
      abi: vaultAbi,
      functionName: "rollEpoch",
    });
  };

  return (
    <div className="space-y-6">
      {!isVaultOwner && (
        <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-500">
          Budget access: {vaultActionReason ?? "Vault owner only"}.
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
                  authorized={isVaultOwner}
                  unauthorizedReason={vaultActionReason ?? "Vault owner only"}
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
                  authorized={isVaultOwner}
                  unauthorizedReason={vaultActionReason ?? "Vault owner only"}
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
                  authorized={isVaultOwner}
                  unauthorizedReason={vaultActionReason ?? "Vault owner only"}
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
              disabled={!!vaultActionReason || pending !== null}
              title={vaultActionReason}
              className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-xs text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-40"
            >
              {pending === "topup"
                ? "encrypting + adding…"
                : "encrypt & top up"}
            </button>
            <button
              onClick={rollEpoch}
              disabled={!!rollReason || pending !== null}
              title={rollReason}
              className="rounded border border-red-900 bg-red-950/30 px-4 py-1.5 font-mono text-xs text-red-300 transition-colors hover:bg-red-900/30 disabled:opacity-40"
            >
              {pending === "roll" ? "settling…" : "settle window now"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            {rollReason ? `${rollReason}.` : "Anyone can settle after expiry."} Unspent budget carries into the next epoch.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-zinc-400">
            Create buyback
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
              disabled={!!vaultActionReason || pending !== null}
              title={vaultActionReason}
              className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-sm text-yellow-300 transition-colors hover:bg-yellow-900/40 disabled:opacity-40"
            >
              {pending === "open" ? "Encrypting and creating..." : "Create buyback"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Starts the buyback in the existing vault. Fund it with cUSDT first. An underfunded claim can transfer zero payment.
          </p>
        </section>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="mb-3 font-mono text-sm uppercase tracking-widest text-zinc-400">
          price oracle (mock)
        </h2>
        <p className="mb-3 text-xs text-zinc-600">
          Demo settlement price. {oracleActionReason ? `${oracleActionReason}.` : ""}
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
            disabled={!!priceActionReason || pending !== null}
            title={priceActionReason}
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
