"use client";

import { useReadContract, useReadContracts } from "wagmi";

import { CONTRACTS, vaultAbi } from "@/config/contracts";

export type EpochData = {
  budget: `0x${string}`;
  remaining: `0x${string}`;
  totalFilled: `0x${string}`;
  settlementPrice: bigint;
  openedAt: bigint;
  endsAt: bigint;
  closedAt: bigint;
  open: boolean;
  disclosed: boolean;
  disclosedTotal: bigint;
};

export function useEpochs() {
  const { data: count } = useReadContract({
    address: CONTRACTS.vault,
    abi: vaultAbi,
    functionName: "epochCount",
  });

  const ids =
    count !== undefined
      ? Array.from({ length: Number(count) }, (_, i) => BigInt(i))
      : [];
  const { data: results } = useReadContracts({
    contracts: ids.map((id) => ({
      address: CONTRACTS.vault,
      abi: vaultAbi,
      functionName: "getEpoch" as const,
      args: [id] as const,
    })),
    query: { enabled: ids.length > 0 },
  });

  const epochs = (results ?? [])
    .map((r, i) => ({ id: ids[i], epoch: r.result as unknown as EpochData }))
    .filter((e) => e.epoch !== undefined);

  return { count: count !== undefined ? Number(count) : undefined, epochs };
}
