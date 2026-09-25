"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import {
  VESTING_CHAIN_ID,
  VESTING_CONTRACT,
  VESTING_DEPLOYMENT_BLOCK,
  vestingAbi,
} from "./contracts";
import {
  discoverVestingGrants,
  type VestingReadClient,
} from "./data";

export type VestingDiscoveryState =
  | "disconnected"
  | "wrong-network"
  | "loading"
  | "empty"
  | "error"
  | "ready";

function createVestingReadClient(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
): VestingReadClient {
  return {
    async grantIdsForParty({ role, wallet, fromBlock }) {
      const args = role === "treasury" ? { treasury: wallet } : { recipient: wallet };
      const events = await publicClient.getContractEvents({
        address: VESTING_CONTRACT,
        abi: vestingAbi,
        eventName: "GrantCreated",
        args,
        fromBlock,
      });

      return events
        .map((event) => event.args.grantId)
        .filter((id): id is bigint => id !== undefined);
    },
    async readGrant(id) {
      return publicClient.readContract({
        address: VESTING_CONTRACT,
        abi: vestingAbi,
        functionName: "getGrant",
        args: [id],
      });
    },
  };
}

export function useVestingGrants() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: VESTING_CHAIN_ID });
  const onVestingChain = chainId === VESTING_CHAIN_ID;
  const enabled = Boolean(address && onVestingChain && publicClient);
  const query = useQuery({
    queryKey: ["vesting-grants", VESTING_CHAIN_ID, address?.toLowerCase()],
    enabled,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: () => {
      if (!address || !publicClient) throw new Error("Wallet connection is unavailable.");
      return discoverVestingGrants(
        createVestingReadClient(publicClient),
        address,
        VESTING_DEPLOYMENT_BLOCK,
      );
    },
  });
  const grants = enabled ? query.data ?? [] : [];
  const state: VestingDiscoveryState = !address
    ? "disconnected"
    : !onVestingChain
      ? "wrong-network"
      : query.isPending || query.isFetching
        ? "loading"
        : query.isError
          ? "error"
          : grants.length === 0
            ? "empty"
            : "ready";

  return { state, grants: state === "ready" ? grants : [], error: query.error };
}
