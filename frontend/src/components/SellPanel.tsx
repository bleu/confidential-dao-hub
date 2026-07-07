"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";

import { EncryptedValue } from "@/components/EncryptedValue";
import { CONTRACTS, tokenAbi, vaultAbi } from "@/config/contracts";
import { encryptAmount } from "@/lib/fhevm";
import { parseAmount } from "@/lib/format";
import { useEpochs } from "@/lib/useEpochs";
import { useTx } from "@/lib/useTx";

const OPERATOR_TTL_HOURS = 24;

function Step({ n, done, active, children }: { n: number; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-3 ${active || done ? "" : "opacity-50"}`}>
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${
          done ? "border-yellow-600 bg-yellow-950 text-yellow-300" : "border-zinc-700 text-zinc-400"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function SellPanel() {
  const { address } = useAccount();
  const { send, pending, error } = useTx();
  const [faucetInput, setFaucetInput] = useState("1000");
  const [offerInput, setOfferInput] = useState("100");

  const { data: hasOpen } = useReadContract({ address: CONTRACTS.vault, abi: vaultAbi, functionName: "hasOpenEpoch" });
  const { data: currentId } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "currentEpochId",
  });
  const { data: isOperator } = useReadContract({
    address: CONTRACTS.cToken,
    abi: tokenAbi,
    functionName: "isOperator",
    args: address ? [address, CONTRACTS.vault] : undefined,
    query: { enabled: !!address },
  });
  const { data: balanceHandle } = useReadContract({
    address: CONTRACTS.cToken,
    abi: tokenAbi,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { epochs } = useEpochs();

  // My position in every epoch (submitted/claimed flags are plaintext).
  const { data: positions } = useReadContracts({
    contracts: epochs.map(({ id }) => ({
      address: CONTRACTS.vault,
      abi: vaultAbi,
      functionName: "getPosition" as const,
      args: [id, address!] as const,
    })),
    query: { enabled: !!address && epochs.length > 0 },
  });
  // getMyOffer/getMyFill depend on msg.sender, so they must be plain eth_calls
  // with the connected account as `from` — wagmi's multicall batching would make
  // msg.sender the Multicall3 contract and silently return empty handles.
  const publicClient = usePublicClient();
  const { data: myHandles } = useQuery({
    queryKey: ["myHandles", address, epochs.length],
    enabled: !!address && !!publicClient && epochs.length > 0,
    queryFn: async () => {
      const out: Record<string, { offer: `0x${string}`; fill: `0x${string}` }> = {};
      for (const { id } of epochs) {
        const common = { address: CONTRACTS.vault, abi: vaultAbi, args: [id], account: address } as const;
        const [offer, fill] = await Promise.all([
          publicClient!.readContract({ ...common, functionName: "getMyOffer" }),
          publicClient!.readContract({ ...common, functionName: "getMyFill" }),
        ]);
        out[id.toString()] = { offer, fill };
      }
      return out;
    },
  });

  const myEpochs = epochs
    .map((e, i) => ({
      ...e,
      submitted: (positions?.[i]?.result as [boolean, boolean] | undefined)?.[0] ?? false,
      claimed: (positions?.[i]?.result as [boolean, boolean] | undefined)?.[1] ?? false,
      offerHandle: myHandles?.[e.id.toString()]?.offer,
      fillHandle: myHandles?.[e.id.toString()]?.fill,
    }))
    .filter((e) => e.submitted);

  const submittedCurrent = hasOpen && myEpochs.some((e) => e.id === currentId);

  if (!address) {
    return <p className="text-sm text-zinc-500">Connect a wallet to sell into the buyback.</p>;
  }

  const faucet = () =>
    send("faucet", () => {
      const amount = parseAmount(faucetInput);
      return Promise.resolve({
        address: CONTRACTS.cToken,
        abi: tokenAbi,
        functionName: "faucet" as const,
        args: [amount] as const,
      });
    });

  const approveOperator = () =>
    send("operator", {
      address: CONTRACTS.cToken,
      abi: tokenAbi,
      functionName: "setOperator",
      args: [CONTRACTS.vault, BigInt(Math.floor(Date.now() / 1000) + OPERATOR_TTL_HOURS * 3600)],
    });

  const submitOffer = () =>
    send("offer", async () => {
      const amount = parseAmount(offerInput);
      const enc = await encryptAmount(CONTRACTS.vault, address, amount);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "submitOffer",
        args: [enc.handle, enc.proof],
      };
    });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-400">sell into the buyback</h2>
          <span className="text-sm text-zinc-500">
            balance:{" "}
            <EncryptedValue handle={balanceHandle} contractAddress={CONTRACTS.cToken} unit="cTOKEN" />
          </span>
        </div>

        <div className="space-y-5">
          <Step n={1} done={false} active>
            <p className="mb-2 text-sm text-zinc-300">Get demo cTOKEN from the faucet (public mint, PoC only).</p>
            <div className="flex items-center gap-3">
              <input
                value={faucetInput}
                onChange={(e) => setFaucetInput(e.target.value)}
                className="w-32 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-yellow-600"
              />
              <button
                onClick={faucet}
                disabled={pending !== null}
                className="rounded border border-zinc-600 px-3 py-1.5 font-mono text-xs text-zinc-300 hover:border-zinc-400 disabled:opacity-40"
              >
                {pending === "faucet" ? "minting…" : "faucet"}
              </button>
            </div>
          </Step>

          <Step n={2} done={!!isOperator} active={!isOperator}>
            <p className="mb-2 text-sm text-zinc-300">
              Authorize the vault as an operator on cTOKEN so it can pull your escrow ({OPERATOR_TTL_HOURS}h expiry).
            </p>
            {!isOperator && (
              <button
                onClick={approveOperator}
                disabled={pending !== null}
                className="rounded border border-zinc-600 px-3 py-1.5 font-mono text-xs text-zinc-300 hover:border-zinc-400 disabled:opacity-40"
              >
                {pending === "operator" ? "approving…" : "approve vault"}
              </button>
            )}
          </Step>

          <Step n={3} done={!!submittedCurrent} active={!!isOperator && !!hasOpen && !submittedCurrent}>
            <p className="mb-2 text-sm text-zinc-300">
              {hasOpen
                ? `Offer cTOKEN into epoch #${currentId?.toString()} - the amount is encrypted in your browser. One offer per epoch.`
                : "No epoch is currently open - wait for the treasury to open one."}
            </p>
            {hasOpen && !submittedCurrent && (
              <div className="flex items-center gap-3">
                <input
                  value={offerInput}
                  onChange={(e) => setOfferInput(e.target.value)}
                  className="w-32 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-yellow-300 outline-none focus:border-yellow-600"
                />
                <button
                  onClick={submitOffer}
                  disabled={!isOperator || pending !== null}
                  className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-xs text-yellow-300 hover:bg-yellow-900/40 disabled:opacity-40"
                >
                  {pending === "offer" ? "encrypting + submitting…" : "encrypt & submit offer"}
                </button>
              </div>
            )}
          </Step>
        </div>
      </section>

      {myEpochs.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-zinc-400">my positions</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 font-mono text-xs uppercase text-zinc-600">
                <th className="pb-2 pr-4">epoch</th>
                <th className="pb-2 pr-4">offer</th>
                <th className="pb-2 pr-4">fill</th>
                <th className="pb-2 pr-4">payout (fill × price)</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {myEpochs.map((e) => (
                <tr key={e.id.toString()} className="border-b border-zinc-900">
                  <td className="py-3 pr-4 font-mono text-zinc-400">#{e.id.toString()}</td>
                  <td className="py-3 pr-4">
                    <EncryptedValue handle={e.offerHandle} contractAddress={CONTRACTS.vault} unit="cTOKEN" />
                  </td>
                  <td className="py-3 pr-4">
                    <EncryptedValue handle={e.fillHandle} contractAddress={CONTRACTS.vault} unit="cTOKEN" />
                  </td>
                  <td className="py-3 pr-4">
                    <EncryptedValue
                      handle={e.fillHandle}
                      contractAddress={CONTRACTS.vault}
                      unit="cUSDT"
                      scale={e.epoch.price}
                    />
                  </td>
                  <td className="py-3 text-right">
                    {e.epoch.open ? (
                      <span className="font-mono text-xs text-zinc-600">epoch live</span>
                    ) : e.claimed ? (
                      <span className="font-mono text-xs text-yellow-500">claimed ✓</span>
                    ) : (
                      <button
                        onClick={() =>
                          send(`claim-${e.id}`, {
                            address: CONTRACTS.vault,
                            abi: vaultAbi,
                            functionName: "claim",
                            args: [e.id],
                          })
                        }
                        disabled={pending !== null}
                        className="rounded border border-yellow-600 bg-yellow-950/40 px-3 py-1 font-mono text-xs text-yellow-300 hover:bg-yellow-900/40 disabled:opacity-40"
                      >
                        {pending === `claim-${e.id}` ? "claiming…" : "claim"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-zinc-600">
            Claiming pays fill × price in cUSDT and refunds offer − fill in cTOKEN, both as confidential transfers.
          </p>
        </section>
      )}

      {error && <p className="break-all rounded border border-red-900 bg-red-950/20 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
