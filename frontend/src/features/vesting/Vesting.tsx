"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";

import { type SignTypedDataFn } from "@/lib/decryption-client";
import { DecryptionProvider, useDecryption } from "@/lib/decryption-context";

import {
  findVestingToken,
  formatVestingTokenAmount,
  type VestingToken,
  VESTING_DECRYPTION_SCOPE,
  vestingAbi,
} from "./contracts";
import { VestingCreateGrantPanel } from "./CreateGrantPanel";
import {
  estimateGrant,
  fundingState,
  grantRolesFor,
  normalizeGrant,
  type PrivateGrantAmounts,
  type PublicGrant,
  type VestingGrantRead,
} from "./data";
import { VestingGrantActionPanel } from "./VestingGrantActionPanel";
import { decryptPrivateGrantAmounts } from "./privateAccounting";
import { VestingGrantList } from "./VestingGrantList";
import { useVestingGrants } from "./useGrants";

export type VestingWorkspace = "community" | "dao";

const panel = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";
const disabledButton = "cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500";

export function Vesting({
  workspace,
  grantId,
}: {
  workspace: VestingWorkspace;
  grantId?: bigint;
}) {
  return (
    <DecryptionProvider scope={VESTING_DECRYPTION_SCOPE}>
      <VestingContent workspace={workspace} grantId={grantId} />
    </DecryptionProvider>
  );
}

function VestingContent({
  workspace,
  grantId,
}: {
  workspace: VestingWorkspace;
  grantId?: bigint;
}) {
  const { address, chainId } = useAccount();
  const { state, grants } = useVestingGrants();
  const role = workspace === "dao" ? "created" : "received";
  const roleGrants = grants.filter((grant) => grantRolesFor(grant, address ?? grant.treasury).includes(role));
  const listState = state === "ready" && roleGrants.length === 0 ? "empty" : state;
  const grant = grantId === undefined ? undefined : roleGrants.find((item) => item.id === grantId);

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-yellow-300">{workspace === "dao" ? "DAO dashboard / Vesting" : "Community / My vesting"}</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-zinc-100">{grantId === undefined ? workspace === "dao" ? "Vesting" : "My vesting" : `Grant ${grantId}`}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{workspace === "dao" ? "Review grants created by this connected treasury." : "Review grants received by this connected wallet."}</p>
      </header>

      {grantId === undefined ? (
        <>
          {workspace === "dao" && <VestingCreateGrantPanel />}
          <VestingGrantList
            workspace={workspace}
            state={listState}
            grants={roleGrants}
            hrefFor={(id) => `/${workspace}/vesting/${id}`}
          />
        </>
      ) : grant ? (
        <GrantDetail
          key={`${grant.id}:${address ?? "disconnected"}:${chainId ?? "unknown"}`}
          workspace={workspace}
          grant={grant}
          authorized={grantRolesFor(grant, address ?? grant.treasury).length > 0}
        />
      ) : (
        <DetailState state={state} />
      )}
    </div>
  );
}

function DetailState({ state }: { state: ReturnType<typeof useVestingGrants>["state"] }) {
  if (state === "loading") return <p className="text-sm text-zinc-400">Loading grant…</p>;
  if (state === "error") return <p className="text-sm text-red-300">Could not read this grant. Try again.</p>;
  if (state === "disconnected") return <p className="text-sm text-zinc-400">Connect a wallet to inspect this grant.</p>;
  if (state === "wrong-network") return <p className="text-sm text-zinc-400">Switch to Sepolia to inspect this grant.</p>;
  return <p className="text-sm text-zinc-400">This wallet does not have this grant.</p>;
}

function GrantDetail({
  workspace,
  grant,
  authorized,
}: {
  workspace: VestingWorkspace;
  grant: PublicGrant;
  authorized: boolean;
}) {
  const [currentGrant, setCurrentGrant] = useState(grant);
  useEffect(() => setCurrentGrant(grant), [grant]);
  const token = findVestingToken(currentGrant.token);
  const accounting = usePrivateAccounting(currentGrant, token, authorized, setCurrentGrant);

  return (
    <div className="space-y-5">
      <section className={panel}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Public grant details</p>
        {currentGrant.revokedAt !== null && <p className="mt-4 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">Vesting stopped on {formatTimestamp(currentGrant.revokedAt)}. Previously vested tokens stay claimable.</p>}
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Fact label="Treasury" value={currentGrant.treasury} />
          <Fact label="Recipient" value={currentGrant.recipient} />
          <Fact label="Token" value={token ? `${token.symbol} (${currentGrant.token})` : currentGrant.token} />
          <Fact label="Start" value={formatTimestamp(currentGrant.start)} />
          <Fact label="End" value={formatTimestamp(currentGrant.end)} />
          <Fact label="Cliff" value={currentGrant.cliff === null ? "None" : formatTimestamp(currentGrant.cliff)} />
          <Fact label="Revocability" value={currentGrant.revocable ? "Revocable" : "Not revocable"} />
        </dl>
      </section>

      <PrivateAccounting grant={currentGrant} token={token} authorized={authorized} {...accounting} />
      <VestingGrantActionPanel workspace={workspace} grant={currentGrant} amounts={accounting.amounts} refreshPrivateAccounting={accounting.refresh} />
    </div>
  );
}

function PrivateAccounting({
  grant,
  token,
  authorized,
  state,
  amounts,
  refresh,
}: {
  grant: PublicGrant;
  token: VestingToken | undefined;
  authorized: boolean;
  state: "idle" | "decrypting" | "unavailable";
  amounts: PrivateGrantAmounts | undefined;
  refresh: () => Promise<void>;
}) {
  const { address } = useAccount();
  const confirmedFunding = fundingState(amounts?.allocation, state);
  const nowSeconds = useCurrentTime();
  const estimate = amounts && estimateGrant(grant, amounts, nowSeconds);
  const canDecrypt = Boolean(token && authorized && address);

  return (
    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Private accounting</p>
          <h2 className="mt-2 text-xl text-zinc-100">Encrypted values</h2>
        </div>
        <button type="button" onClick={refresh} disabled={!canDecrypt || state === "decrypting"} className={canDecrypt ? "rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300" : disabledButton}>{state === "decrypting" ? "Decrypting…" : "Decrypt private values"}</button>
      </div>
      {!token ? (
        <p className="mt-3 text-sm leading-6 text-zinc-400">Token metadata is unavailable, so encrypted amounts cannot be displayed safely.</p>
      ) : !authorized ? (
        <p className="mt-3 text-sm leading-6 text-zinc-400">{!address ? "Connect a wallet to decrypt." : "This wallet cannot decrypt this grant."}</p>
      ) : confirmedFunding === "unavailable" ? (
        <p className="mt-3 text-sm leading-6 text-red-300">Private values are unavailable. This does not mean the grant has zero funding.</p>
      ) : confirmedFunding === "zero-funded" ? (
        <p className="mt-3 text-sm leading-6 text-amber-200">This record has zero confirmed funding. It is not a funded grant.</p>
      ) : !amounts || !estimate ? (
        <p className="mt-3 text-sm leading-6 text-zinc-400">Amounts stay encrypted until an authorized wallet decrypts them.</p>
      ) : (
        <>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <Fact label="Allocation" value={formatVestingTokenAmount(amounts.allocation, token)} />
            <Fact label="Vested" value={formatVestingTokenAmount(estimate.vested, token)} />
            <Fact label="Available estimate" value={formatVestingTokenAmount(estimate.available, token)} />
            <Fact label="Claimed" value={formatVestingTokenAmount(amounts.claimed, token)} />
            <Fact label="Unvested" value={formatVestingTokenAmount(estimate.unvested, token)} />
            {grant.revokedAt !== null && <Fact label="Outstanding refund" value={formatVestingTokenAmount(estimate.outstandingRefund, token)} />}
          </dl>
          <p className="mt-3 text-xs leading-5 text-zinc-500">Availability is an estimate because execution time controls a claim.</p>
        </>
      )}
    </section>
  );
}

function usePrivateAccounting(
  grant: PublicGrant,
  token: VestingToken | undefined,
  authorized: boolean,
  onGrantRead: (grant: PublicGrant) => void,
) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const decryption = useDecryption();
  const publicClient = usePublicClient({ chainId: VESTING_DECRYPTION_SCOPE.chainId });
  const [state, setState] = useState<"idle" | "decrypting" | "unavailable">("idle");
  const [decrypted, setDecrypted] = useState<{ client: typeof decryption; amounts: PrivateGrantAmounts }>();
  const requestVersion = useRef(0);
  const context = useRef({ address, chainId, decryption });
  context.current = { address, chainId, decryption };

  useEffect(() => {
    requestVersion.current++;
    setDecrypted(undefined);
    setState("idle");
  }, [address, chainId, decryption, grant.id]);

  const refresh = useCallback(async () => {
    if (!token || !authorized || !address || !publicClient) return;
    const request = ++requestVersion.current;
    const wallet = address;
    const decryptionClient = decryption;
    setState("decrypting");
    try {
      const read = await publicClient.readContract({
        address: VESTING_DECRYPTION_SCOPE.contractAddresses[0],
        abi: vestingAbi,
        functionName: "getGrant",
        args: [grant.id],
      });
      if (request !== requestVersion.current || context.current.address !== wallet || context.current.chainId !== VESTING_DECRYPTION_SCOPE.chainId || context.current.decryption !== decryptionClient) return;
      const latestGrant = normalizeGrant(grant.id, read as unknown as VestingGrantRead);
      const amounts = await decryptPrivateGrantAmounts(
        latestGrant,
        VESTING_DECRYPTION_SCOPE.contractAddresses[0],
        decryptionClient,
        signTypedDataAsync as unknown as SignTypedDataFn,
      );
      if (request !== requestVersion.current || context.current.address !== wallet || context.current.chainId !== VESTING_DECRYPTION_SCOPE.chainId || context.current.decryption !== decryptionClient) return;
      onGrantRead(latestGrant);
      setDecrypted({ client: decryptionClient, amounts });
      setState("idle");
    } catch {
      if (request === requestVersion.current) setState("unavailable");
    }
  }, [address, authorized, decryption, grant.id, onGrantRead, publicClient, signTypedDataAsync, token]);

  return { state, amounts: decrypted?.client === decryption ? decrypted.amounts : undefined, refresh };
}


function useCurrentTime(): bigint {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1_000)));
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return nowSeconds;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 break-all font-mono text-sm text-zinc-100">{value}</dd></div>;
}

function formatTimestamp(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1_000).toISOString().slice(0, 10);
}
