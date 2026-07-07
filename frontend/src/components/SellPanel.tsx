"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
} from "wagmi";

import { EncryptedValue } from "@/components/EncryptedValue";
import { CONTRACTS, oracleAbi, tokenAbi, vaultAbi } from "@/config/contracts";
import {
  encryptValues,
  getCachedDecryption,
  getDecryptionVersion,
  subscribeDecryptions,
} from "@/lib/fhevm";
import {
  formatAmount,
  formatPrice,
  formatTimestamp,
  parseAmount,
  parsePrice,
} from "@/lib/format";
import { useEpochs, type EpochData } from "@/lib/useEpochs";
import { useTx } from "@/lib/useTx";

const OPERATOR_TTL_HOURS = 24;

function Step({
  n,
  done,
  active,
  children,
}: {
  n: number;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-3 ${active || done ? "" : "opacity-50"}`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${
          done
            ? "border-yellow-600 bg-yellow-950 text-yellow-300"
            : "border-zinc-700 text-zinc-400"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** Payout derives from two encrypted values; renders once both are decrypted. */
function PayoutCell({
  epoch,
  fillHandle,
  minHandle,
}: {
  epoch: EpochData;
  fillHandle?: `0x${string}`;
  minHandle?: `0x${string}`;
}) {
  useSyncExternalStore(
    subscribeDecryptions,
    getDecryptionVersion,
    getDecryptionVersion,
  );
  if (epoch.open)
    return <span className="font-mono text-xs text-zinc-600">window live</span>;
  const fill = fillHandle ? getCachedDecryption(fillHandle) : undefined;
  const min = minHandle ? getCachedDecryption(minHandle) : undefined;
  if (fill === undefined || min === undefined) {
    return (
      <span className="font-mono text-xs text-zinc-600">
        🔒 decrypt fill &amp; floor
      </span>
    );
  }
  const floorMet = min <= epoch.settlementPrice;
  const payout = floorMet ? (fill * epoch.settlementPrice) / 100n : 0n;
  return (
    <span className="font-mono text-yellow-300">
      {formatAmount(payout)} <span className="text-zinc-500">cUSDT</span>
      {!floorMet && (
        <span className="ml-1 text-xs text-zinc-500">(floor not met)</span>
      )}
    </span>
  );
}

export function SellPanel() {
  const { address } = useAccount();
  const { send, pending, error } = useTx();
  const [faucetInput, setFaucetInput] = useState("1000");
  const [offerInput, setOfferInput] = useState("100");
  const [floorInput, setFloorInput] = useState("0");

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
  const current =
    hasOpen && currentId !== undefined
      ? epochs.find((e) => e.id === currentId)
      : undefined;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const windowExpired = !!current && current.epoch.endsAt <= nowSec;

  // My position in every window (submitted/claimed flags are plaintext).
  const { data: positions } = useReadContracts({
    contracts: epochs.map(({ id }) => ({
      address: CONTRACTS.vault,
      abi: vaultAbi,
      functionName: "getPosition" as const,
      args: [id, address!] as const,
    })),
    query: { enabled: !!address && epochs.length > 0 },
  });
  // getMyOffer/getMyFill/getMyMinPrice depend on msg.sender, so they must be
  // plain eth_calls with the connected account as `from` — wagmi's multicall
  // batching would make msg.sender the Multicall3 contract and return zeros.
  const publicClient = usePublicClient();
  const { data: myHandles } = useQuery({
    queryKey: ["myHandles", address, epochs.length],
    enabled: !!address && !!publicClient && epochs.length > 0,
    queryFn: async () => {
      const out: Record<
        string,
        { offer: `0x${string}`; fill: `0x${string}`; minPrice: `0x${string}` }
      > = {};
      for (const { id } of epochs) {
        const common = {
          address: CONTRACTS.vault,
          abi: vaultAbi,
          args: [id],
          account: address,
        } as const;
        const [offer, fill, minPrice] = await Promise.all([
          publicClient!.readContract({ ...common, functionName: "getMyOffer" }),
          publicClient!.readContract({ ...common, functionName: "getMyFill" }),
          publicClient!.readContract({
            ...common,
            functionName: "getMyMinPrice",
          }),
        ]);
        out[id.toString()] = { offer, fill, minPrice };
      }
      return out;
    },
  });

  const myEpochs = epochs
    .map((e, i) => ({
      ...e,
      submitted:
        (positions?.[i]?.result as [boolean, boolean] | undefined)?.[0] ??
        false,
      claimed:
        (positions?.[i]?.result as [boolean, boolean] | undefined)?.[1] ??
        false,
      handles: myHandles?.[e.id.toString()],
    }))
    .filter((e) => e.submitted);

  const submittedCurrent = hasOpen && myEpochs.some((e) => e.id === currentId);

  if (!address) {
    return (
      <p className="text-sm text-zinc-500">
        Connect a wallet to sell into the buyback.
      </p>
    );
  }

  const faucet = () =>
    send("faucet", () =>
      Promise.resolve({
        address: CONTRACTS.cToken,
        abi: tokenAbi,
        functionName: "faucet" as const,
        args: [parseAmount(faucetInput)] as const,
      }),
    );

  const approveOperator = () =>
    send("operator", {
      address: CONTRACTS.cToken,
      abi: tokenAbi,
      functionName: "setOperator",
      args: [
        CONTRACTS.vault,
        BigInt(Math.floor(Date.now() / 1000) + OPERATOR_TTL_HOURS * 3600),
      ],
    });

  const submitOffer = () =>
    send("offer", async () => {
      const amount = parseAmount(offerInput);
      const floor = parsePrice(floorInput || "0");
      const enc = await encryptValues(CONTRACTS.vault, address, [
        amount,
        floor,
      ]);
      return {
        address: CONTRACTS.vault,
        abi: vaultAbi,
        functionName: "submitOffer",
        args: [enc.handles[0], enc.handles[1], enc.proof],
      };
    });

  const settleWindow = () =>
    send("roll", {
      address: CONTRACTS.vault,
      abi: vaultAbi,
      functionName: "rollEpoch",
    });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-400">
            sell into the buyback
          </h2>
          <span className="text-sm text-zinc-500">
            balance:{" "}
            <EncryptedValue
              handle={balanceHandle}
              contractAddress={CONTRACTS.cToken}
              unit="cTOKEN"
            />
          </span>
        </div>

        {current && (
          <p className="mb-5 rounded border border-zinc-800 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-500">
            window #{current.id.toString()} · oracle{" "}
            {oraclePrice !== undefined ? formatPrice(oraclePrice) : "…"}{" "}
            cUSDT/cTOKEN ·{" "}
            {windowExpired ? (
              <>
                ended — settle to lock the price{" "}
                <button
                  onClick={settleWindow}
                  disabled={pending !== null}
                  className="ml-1 rounded border border-yellow-600 px-2 py-0.5 text-yellow-300 hover:bg-yellow-900/40 disabled:opacity-40"
                >
                  {pending === "roll" ? "settling…" : "settle window"}
                </button>
              </>
            ) : (
              <>settles {formatTimestamp(current.epoch.endsAt)}</>
            )}
          </p>
        )}

        <div className="space-y-5">
          <Step n={1} done={false} active>
            <p className="mb-2 text-sm text-zinc-300">
              Get demo cTOKEN from the faucet (public mint, PoC only).
            </p>
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
              Authorize the vault as an operator on cTOKEN so it can pull your
              escrow ({OPERATOR_TTL_HOURS}h expiry). The vault only moves what
              you offer, in the same transaction as your offer.
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

          <Step
            n={3}
            done={!!submittedCurrent}
            active={!!isOperator && !!hasOpen && !submittedCurrent}
          >
            <p className="mb-2 text-sm text-zinc-300">
              {hasOpen
                ? "Offer cTOKEN with a private price floor — both encrypted in your browser. The window settles at the oracle price; if it lands below your floor you&apos;re refunded in full, and nobody can tell."
                : "The pool has not been opened by the treasury yet."}
            </p>
            {hasOpen && !submittedCurrent && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-zinc-500">
                  amount (cTOKEN)
                  <input
                    value={offerInput}
                    onChange={(e) => setOfferInput(e.target.value)}
                    className="mt-1 block w-32 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-yellow-300 outline-none focus:border-yellow-600"
                  />
                </label>
                <label className="text-xs text-zinc-500">
                  price floor (cUSDT, private · 0 = any)
                  <input
                    value={floorInput}
                    onChange={(e) => setFloorInput(e.target.value)}
                    className="mt-1 block w-40 rounded border border-zinc-700 bg-black px-3 py-1.5 font-mono text-sm text-yellow-300 outline-none focus:border-yellow-600"
                  />
                </label>
                <button
                  onClick={submitOffer}
                  disabled={!isOperator || pending !== null}
                  className="rounded border border-yellow-600 bg-yellow-950/40 px-4 py-1.5 font-mono text-xs text-yellow-300 hover:bg-yellow-900/40 disabled:opacity-40"
                >
                  {pending === "offer"
                    ? "encrypting + submitting…"
                    : "encrypt & submit offer"}
                </button>
              </div>
            )}
          </Step>
        </div>
      </section>

      {myEpochs.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-mono text-sm uppercase tracking-widest text-zinc-400">
            my positions
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 font-mono text-xs uppercase text-zinc-600">
                  <th className="pb-2 pr-4">window</th>
                  <th className="pb-2 pr-4">offer</th>
                  <th className="pb-2 pr-4">my floor</th>
                  <th className="pb-2 pr-4">fill</th>
                  <th className="pb-2 pr-4">payout</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {myEpochs.map((e) => (
                  <tr
                    key={e.id.toString()}
                    className="border-b border-zinc-900"
                  >
                    <td className="py-3 pr-4 font-mono text-zinc-400">
                      #{e.id.toString()}
                      <span className="ml-2 text-xs text-zinc-600">
                        {e.epoch.open
                          ? "live"
                          : `@ ${formatPrice(e.epoch.settlementPrice)}`}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <EncryptedValue
                        handle={e.handles?.offer}
                        contractAddress={CONTRACTS.vault}
                        unit="cTOKEN"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <EncryptedValue
                        handle={e.handles?.minPrice}
                        contractAddress={CONTRACTS.vault}
                        format={(v) => (v === 0n ? "any" : formatPrice(v))}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <EncryptedValue
                        handle={e.handles?.fill}
                        contractAddress={CONTRACTS.vault}
                        unit="cTOKEN"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <PayoutCell
                        epoch={e.epoch}
                        fillHandle={e.handles?.fill}
                        minHandle={e.handles?.minPrice}
                      />
                    </td>
                    <td className="py-3 text-right">
                      {e.epoch.open ? (
                        <span className="font-mono text-xs text-zinc-600">
                          window live
                        </span>
                      ) : e.claimed ? (
                        <span className="font-mono text-xs text-yellow-500">
                          claimed ✓
                        </span>
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
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Claiming pays fill × settlement price in cUSDT and refunds the rest
            in cTOKEN, both as confidential transfers. If the settlement price
            missed your floor, you&apos;re refunded in full.
          </p>
        </section>
      )}

      {error && (
        <p className="break-all rounded border border-red-900 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
