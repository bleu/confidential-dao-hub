"use client";

import { useEffect, useRef, useState } from "react";
import { parseEventLogs, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useSignTypedData } from "wagmi";
import { useRouter } from "next/navigation";

import { type SignTypedDataFn } from "../../lib/decryption-client";
import { useDecryption } from "../../lib/decryption-context";
import { encryptAmount } from "../../lib/fhevm";
import { useTx } from "../../lib/useTx";

import { VESTING_CHAIN_ID, VESTING_CONTRACT, VESTING_DECRYPTION_SCOPE, VESTING_TOKENS, tokenAbi, vestingAbi } from "./contracts";
import { createGrant, retryPrivateFundingCheck, type GrantCreationState } from "./grantCreation";
import {
  prepareCreateGrant,
  prepareGrantSchedule,
  type CreateGrantErrors,
  type CreateGrantPreparation,
  type CreateGrantRequest,
  type DurationUnit,
} from "./data";

export type VestingToken = {
  address: Address;
  symbol: string;
  decimals: number;
};

type FormValues = {
  recipient: string;
  token: Address;
  allocation: string;
  customStart: boolean;
  start: string;
  vestingDuration: string;
  vestingUnit: DurationUnit;
  cliffDuration: string;
  cliffUnit: DurationUnit;
  revocable: boolean;
};

export function VestingCreateGrantForm({
  treasury,
  tokens,
  nowSeconds,
  onConfirm,
}: {
  treasury: Address;
  tokens: readonly VestingToken[];
  nowSeconds: bigint;
  onConfirm: (request: CreateGrantRequest) => void;
}) {
  const [values, setValues] = useState<FormValues>({
    recipient: "",
    token: tokens[0]?.address ?? "0x0000000000000000000000000000000000000000",
    allocation: "",
    customStart: false,
    start: "",
    vestingDuration: "",
    vestingUnit: "day",
    cliffDuration: "0",
    cliffUnit: "day",
    revocable: false,
  });
  const [errors, setErrors] = useState<CreateGrantErrors>({});
  const [review, setReview] = useState<Extract<CreateGrantPreparation, { request: CreateGrantRequest }>>();

  function update<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function reviewGrant() {
    const selectedToken = tokens.find((token) => token.address === values.token);
    if (!selectedToken) return;
    const schedule = prepareGrantSchedule({
      start: values.customStart ? toSeconds(values.start) : nowSeconds,
      vestingDuration: values.vestingDuration,
      vestingUnit: values.vestingUnit,
      cliffDuration: values.cliffDuration,
      cliffUnit: values.cliffUnit,
    });
    if ("errors" in schedule) {
      setErrors(schedule.errors);
      return;
    }
    const result = prepareCreateGrant(
      {
        recipient: values.recipient,
        token: selectedToken.address,
        vestingContract: VESTING_CONTRACT,
        allocation: values.allocation,
        tokenDecimals: selectedToken.decimals,
        start: schedule.start,
        end: schedule.end,
        cliff: schedule.cliff === 0n ? null : schedule.cliff,
        revocable: values.revocable,
      },
      nowSeconds,
    );
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setReview(result);
  }

  if (review) {
    const { request, preview } = review;
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Review grant</p>
        <h2 className="mt-2 text-xl text-zinc-100">Confirm immutable terms</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">These terms are fixed after the transaction. A grant cannot be edited, topped up, or reassigned.</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <ReviewFact label="Fixed treasury" value={treasury} />
          <ReviewFact label="Fixed recipient" value={request.recipient} />
          <ReviewFact label="Fixed token" value={tokens.find((token) => token.address === request.token)?.symbol ?? request.token} />
          <ReviewFact label="Allocation" value={values.allocation} />
          <ReviewFact label="Start" value={formatDate(request.start)} />
          <ReviewFact label="End" value={formatDate(request.end)} />
          <ReviewFact label="Cliff" value={request.cliff === 0n ? "None" : formatDate(request.cliff)} />
          <ReviewFact label="Revocability" value={request.revocable ? "Revocable" : "Not revocable"} />
        </dl>
        {preview.cliffPassed ? (
          <p className="mt-4 text-sm leading-6 text-zinc-400">The schedule has {preview.vested.toString()} base units vested at this browser time. Transaction execution time controls the final amount.</p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-amber-200">The cliff has not passed. Accrued tokens are not available yet.</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => setReview(undefined)} className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200">Back</button>
          <button type="button" onClick={() => onConfirm(request)} className="rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">Confirm grant</button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Create grant</p>
      <h2 className="mt-2 text-xl text-zinc-100">Fund a new grant</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Recipient" error={errors.recipient}><input id="recipient" value={values.recipient} onChange={(event) => update("recipient", event.target.value)} className={inputClass} /></Field>
        <Field label="Token"><select id="token" value={values.token} onChange={(event) => update("token", event.target.value as Address)} className={inputClass}>{tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}</select></Field>
        <Field label="Allocation" error={errors.allocation}><input id="allocation" inputMode="decimal" value={values.allocation} onChange={(event) => update("allocation", event.target.value)} className={inputClass} /></Field>
        <Field label="Vesting duration" error={errors.vestingDuration}><input id="vesting-duration" type="number" min="1" step="1" inputMode="numeric" value={values.vestingDuration} onChange={(event) => update("vestingDuration", event.target.value)} className={inputClass} /></Field>
        <Field label="Vesting unit"><select id="vesting-unit" value={values.vestingUnit} onChange={(event) => update("vestingUnit", event.target.value as DurationUnit)} className={inputClass}><DurationOptions /></select></Field>
        <Field label="Cliff duration" error={errors.cliffDuration}><input id="cliff-duration" type="number" min="0" step="1" inputMode="numeric" value={values.cliffDuration} onChange={(event) => update("cliffDuration", event.target.value)} className={inputClass} /></Field>
        <Field label="Cliff unit"><select id="cliff-unit" value={values.cliffUnit} onChange={(event) => update("cliffUnit", event.target.value as DurationUnit)} className={inputClass}><DurationOptions /></select></Field>
        <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-200"><input id="custom-start" type="checkbox" checked={values.customStart} onChange={(event) => update("customStart", event.target.checked)} /> Set custom start date</label>
        {values.customStart && <Field label="Custom start date" error={errors.start}><input id="custom-start-date" type="date" value={values.start} onChange={(event) => update("start", event.target.value)} className={inputClass} /></Field>}
        <fieldset className="sm:col-span-2"><legend className="text-sm text-zinc-300">Revocability</legend><div className="mt-1 grid gap-2 sm:grid-cols-2"><label className={choiceClass(!values.revocable)}><input type="radio" name="revocability" checked={!values.revocable} onChange={() => update("revocable", false)} /> Not revocable</label><label className={choiceClass(values.revocable)}><input type="radio" name="revocability" checked={values.revocable} onChange={() => update("revocable", true)} /> Revocable</label></div></fieldset>
      </div>
      <p className="mt-4 text-sm leading-6 text-zinc-400">The connected wallet is the fixed treasury and refund destination. The selected token, recipient, schedule, and revocability are permanent.</p>
      <button type="button" onClick={reviewGrant} className="mt-5 rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">Review grant</button>
    </section>
  );
}

export function VestingCreateGrantPanel() {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const wallet = address;
  const publicClient = usePublicClient({ chainId: VESTING_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const decryption = useDecryption();
  const { send, sendWithReceipt, pending, error } = useTx();
  const [request, setRequest] = useState<CreateGrantRequest>();
  const [creation, setCreation] = useState<GrantCreationState>();
  const version = useRef(0);
  const currentContext = useRef({ address, chainId, decryption });
  currentContext.current = { address, chainId, decryption };
  const onVestingChain = chainId === VESTING_CHAIN_ID;
  const selectedToken = request && VESTING_TOKENS.find((token) => token.address === request.token);
  const operator = useReadContract({
    address: selectedToken?.address,
    abi: tokenAbi,
    functionName: "isOperator",
    args: wallet ? [wallet, VESTING_CONTRACT] : undefined,
    query: { enabled: Boolean(wallet && selectedToken && onVestingChain) },
  });

  useEffect(() => {
    version.current++;
    setRequest(undefined);
    setCreation(undefined);
  }, [address, chainId, decryption]);

  if (!wallet) return <p className="text-sm text-zinc-400">Connect the treasury wallet to create a grant.</p>;
  if (!onVestingChain) return <p className="text-sm text-zinc-400">Switch to Sepolia to create a grant.</p>;

  async function authorize() {
    if (!selectedToken) return;
    await send("vesting-operator", {
      address: selectedToken.address,
      abi: tokenAbi,
      functionName: "setOperator",
      args: [VESTING_CONTRACT, (1n << 48n) - 1n],
    });
  }

  async function submitGrant(nextRequest: CreateGrantRequest) {
    if (!publicClient || !wallet) return;
    const operation = ++version.current;
    const treasury = wallet;
    const decryptionClient = decryption;
    const current = () =>
      version.current === operation &&
      currentContext.current.address === treasury &&
      currentContext.current.chainId === VESTING_CHAIN_ID &&
      currentContext.current.decryption === decryptionClient;
    const report = (state: GrantCreationState) => {
      if (current()) setCreation(state);
    };
    const adapters = {
      vestingContract: VESTING_CONTRACT,
      treasury,
      current,
      encrypt: encryptAmount,
      submit: async (args: CreateGrantRequest & { handle: `0x${string}`; proof: `0x${string}` }, onSubmitted: (hash: `0x${string}`) => void) => {
        const transaction = await sendWithReceipt(
          "create-vesting-grant",
          {
            address: VESTING_CONTRACT,
            abi: vestingAbi,
            functionName: "createGrant",
            args: [args.recipient, args.token, args.start, args.end, args.cliff, args.revocable, args.handle, args.proof],
          },
          onSubmitted,
        );
        if (!transaction.ok) throw new Error(transaction.message);
        return transaction.receipt;
      },
      grantIdFromReceipt: (receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>) => {
        const event = parseEventLogs({ abi: vestingAbi, eventName: "GrantCreated", logs: receipt.logs, strict: true })[0];
        if (!event?.args.grantId) throw new Error("The grant ID was missing from the transaction receipt.");
        return event.args.grantId;
      },
      readGrant: async (grantId: bigint) => publicClient.readContract({ address: VESTING_CONTRACT, abi: vestingAbi, functionName: "getGrant", args: [grantId] }),
      decryptAllocation: async (grant: Awaited<ReturnType<typeof publicClient.readContract>>) => {
        const values = await decryption.userDecrypt(
          [{ handle: (grant as { allocation: `0x${string}` }).allocation, contractAddress: VESTING_DECRYPTION_SCOPE.contractAddresses[0] }],
          signTypedDataAsync as unknown as SignTypedDataFn,
        );
        return values.get((grant as { allocation: `0x${string}` }).allocation)!;
      },
    };
    const result = await createGrant(nextRequest, adapters, report);
    if (result.state === "funded" && current()) router.push(`/dao/vesting/${result.grantId}`);
  }

  async function retryFundingCheck() {
    if (!creation || (creation.state !== "retryable-decryption-error") || !publicClient || !wallet) return;
    const operation = ++version.current;
    const treasury = wallet;
    const decryptionClient = decryption;
    const current = () =>
      version.current === operation &&
      currentContext.current.address === treasury &&
      currentContext.current.chainId === VESTING_CHAIN_ID &&
      currentContext.current.decryption === decryptionClient;
    const report = (state: GrantCreationState) => {
      if (current()) setCreation(state);
    };
    const result = await retryPrivateFundingCheck(creation.grantId, {
      vestingContract: VESTING_CONTRACT,
      treasury: wallet,
      current,
      encrypt: encryptAmount,
      submit: async () => { throw new Error("A private funding check does not submit a transaction."); },
      grantIdFromReceipt: () => { throw new Error("A private funding check has no receipt."); },
      readGrant: (grantId) => publicClient.readContract({ address: VESTING_CONTRACT, abi: vestingAbi, functionName: "getGrant", args: [grantId] }),
      decryptAllocation: async (grant) => {
        const handle = (grant as { allocation: `0x${string}` }).allocation;
        const values = await decryption.userDecrypt([{ handle, contractAddress: VESTING_CONTRACT }], signTypedDataAsync as unknown as SignTypedDataFn);
        return values.get(handle)!;
      },
    }, report);
    if (result.state === "funded" && current()) router.push(`/dao/vesting/${result.grantId}`);
  }

  if (!request) {
    return <VestingCreateGrantForm treasury={wallet} tokens={VESTING_TOKENS} nowSeconds={BigInt(Math.floor(Date.now() / 1_000))} onConfirm={setRequest} />;
  }

  if (operator.data !== true) {
    return <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Authorization</p><h2 className="mt-2 text-xl text-zinc-100">Authorize confidential funding</h2><p className="mt-3 text-sm leading-6 text-zinc-400">Authorize the vesting contract to transfer the selected confidential token. This approval must last through grant creation.</p>{error && <p className="mt-3 text-sm text-red-300">Authorization failed: {error}</p>}<button type="button" onClick={authorize} disabled={pending !== null || operator.isLoading} className="mt-4 rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">{pending === "vesting-operator" ? "Authorizing…" : "Authorize vesting contract"}</button></section>;
  }

  if (!creation || creation.state === "transaction-error") {
    return <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6"><p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Funding</p><h2 className="mt-2 text-xl text-zinc-100">Create and verify grant</h2><p className="mt-3 text-sm leading-6 text-zinc-400">The amount stays encrypted. A mined transaction is not funding confirmation.</p>{creation?.state === "transaction-error" && <p className="mt-3 text-sm text-red-300">Grant creation failed: {creation.message}</p>}<button type="button" onClick={() => submitGrant(request)} disabled={pending !== null} className="mt-4 rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">Encrypt and create grant</button></section>;
  }

  if (creation.state === "retryable-decryption-error") return <ResultPanel message="Grant created, but private funding verification failed. This does not mean zero funding." action="Retry private funding check" onAction={retryFundingCheck} />;
  if (creation.state === "zero-funded") return <ResultPanel message="This grant record has zero confirmed funding. It is not an active funded entitlement. Create a new grant to retry funding." action="Create a new grant" onAction={() => { setRequest(undefined); setCreation(undefined); }} />;
  if (creation.state === "funded") return <ResultPanel message={`Grant ${creation.grantId} is privately verified as funded.`} />;
  if (creation.state === "transaction-pending") return <ResultPanel message="Transaction pending." />;
  if (creation.state === "mined-awaiting-private-check") return <ResultPanel message="Transaction mined. Verifying funding privately…" />;
  return <ResultPanel message="Encrypting grant allocation…" />;
}

function ResultPanel({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6"><p className="text-sm leading-6 text-zinc-300">{message}</p>{action && <button type="button" onClick={onAction} className="mt-4 rounded-md border border-yellow-700 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">{action}</button>}</section>;
}

const inputClass = "mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100";

function DurationOptions() {
  return <><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months (30 days)</option><option value="year">Years (365 days)</option></>;
}

function choiceClass(selected: boolean) {
  return `flex items-center gap-2 rounded-lg border p-3 text-sm ${selected ? "border-yellow-700 bg-yellow-400/10 text-yellow-200" : "border-zinc-800 bg-zinc-950/40 text-zinc-200"}`;
}

function formatDate(seconds: bigint): string {
  return new Date(Number(seconds) * 1_000).toISOString().slice(0, 10);
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm text-zinc-300">{label}{children}{error && <span className="mt-1 block text-xs text-red-300">{error}</span>}</label>;
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 break-all font-mono text-sm text-zinc-100">{value}</dd></div>;
}

function toSeconds(value: string): bigint {
  return value ? BigInt(Math.floor(new Date(`${value}T00:00:00.000Z`).getTime() / 1_000)) : -1n;
}
