"use client";

import { decodeEventLog, isAddress, type Address, type Hex } from "viem";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useReadContract, useSignTypedData } from "wagmi";
import { sepolia } from "wagmi/chains";

import { DecryptionProvider, useDecryption } from "@/lib/decryption-context";
import { encryptValues } from "@/lib/fhevm";
import { useTx } from "@/lib/useTx";

import { confidentialTokenAbi, PAYROLL_CONTRACTS, payrollDecryptionScope, payrollMultisendAbi } from "./contracts";
import { formatTokenAmount, MAX_ENTRIES, parseTokenAmount, type PaymentEntry, type Token, type Validation, validateEntries } from "./model";

type Workspace = "dao" | "community";
type TouchedFields = Record<string, { recipient?: boolean; amount?: boolean }>;
type PaymentRecord = {
  id: string;
  transactionHash: Hex;
  logIndex: number;
  sender: Address;
  token: Address;
  recipient: Address;
  requestedAmount: Hex;
  actualAmount: Hex;
};
type FrozenPayment = {
  account: Address;
  chainId: number;
  token: Address;
  recipients: Address[];
  amounts: bigint[];
};

type PaymentContext = Pick<FrozenPayment, "account" | "chainId" | "token">;

const DEPLOYMENT_BLOCK = 11765852n;
const DEFAULT_ENTRIES: PaymentEntry[] = [{ id: "entry-1", recipient: "", amount: "" }];
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400";
const action = `inline-flex min-h-11 items-center justify-center rounded-md bg-yellow-300 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 ${focus}`;
const secondary = `inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500 ${focus}`;
const inputClass = (error?: string) => `min-h-11 min-w-0 w-full rounded-md border bg-zinc-950 px-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 ${error ? "border-red-400" : "border-zinc-700"} ${focus}`;

function cloneEntries(entries: PaymentEntry[]) {
  return entries.map((entry) => ({ ...entry }));
}

function tokenFromMetadata(address: Address | undefined, symbol: string | undefined, decimals: number | undefined): Token | undefined {
  if (!address || !symbol || decimals === undefined) return undefined;
  return { address, symbol, decimals };
}

function decodePayment(log: { address: Address; data: Hex; topics: readonly Hex[]; transactionHash: Hex | null; logIndex: number | null }): PaymentRecord | undefined {
  if (log.address.toLowerCase() !== PAYROLL_CONTRACTS.multisend.toLowerCase() || !log.transactionHash || log.logIndex === null) return undefined;
  try {
    const event = decodeEventLog({ abi: payrollMultisendAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    if (event.eventName !== "Payment") return undefined;
    const { sender, token, recipient, requestedAmount, actualAmount } = event.args;
    if (!sender || !token || !recipient || !requestedAmount || !actualAmount) return undefined;
    return {
      id: `${log.transactionHash}:${log.logIndex}`,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      sender,
      token,
      recipient,
      requestedAmount,
      actualAmount,
    };
  } catch {
    return undefined;
  }
}

function PayrollHeader({ title }: { title: string }) {
  return <section className="border-b border-zinc-800 pb-5"><h1 className="text-3xl font-medium tracking-tight text-zinc-100">{title}</h1></section>;
}

export function PayrollDemo({ workspace }: { workspace: Workspace }) {
  const [tokenAddress, setTokenAddress] = useState<string>(PAYROLL_CONTRACTS.demoToken);
  const selectedToken = isAddress(tokenAddress) ? tokenAddress : PAYROLL_CONTRACTS.demoToken;
  const scope = useMemo(() => payrollDecryptionScope(selectedToken), [selectedToken]);

  return <DecryptionProvider scope={scope}>{workspace === "dao" ? <DaoPayroll tokenAddress={tokenAddress} onTokenAddressChange={setTokenAddress} /> : <CommunityPayroll />}</DecryptionProvider>;
}

function DaoPayroll({ tokenAddress, onTokenAddressChange }: { tokenAddress: string; onTokenAddressChange: (address: string) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendWithReceipt, pending, error } = useTx();
  const [entries, setEntries] = useState(() => cloneEntries(DEFAULT_ENTRIES));
  const [showValidation, setShowValidation] = useState(false);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [operatorExpiresAt, setOperatorExpiresAt] = useState<number>();
  const [checkedBalance, setCheckedBalance] = useState<bigint>();
  const [flowError, setFlowError] = useState<string>();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const contextRef = useRef({ address, chainId, tokenAddress });
  const operationRef = useRef(0);
  contextRef.current = { address, chainId, tokenAddress };
  const [sending, setSending] = useState(false);
  const nextEntryId = useRef(2);
  const selectedToken = isAddress(tokenAddress) ? tokenAddress : undefined;
  const canReadToken = isConnected && chainId === sepolia.id && Boolean(selectedToken);
  const { data: tokenSymbol } = useReadContract({ address: selectedToken, abi: confidentialTokenAbi, functionName: "symbol", query: { enabled: canReadToken } });
  const { data: tokenDecimals } = useReadContract({ address: selectedToken, abi: confidentialTokenAbi, functionName: "decimals", query: { enabled: canReadToken } });
  const { data: isOperator, refetch: refetchOperator } = useReadContract({ address: selectedToken, abi: confidentialTokenAbi, functionName: "isOperator", args: address ? [address, PAYROLL_CONTRACTS.multisend] : undefined, query: { enabled: canReadToken && Boolean(address) } });
  const { data: balanceHandle } = useReadContract({ address: selectedToken, abi: confidentialTokenAbi, functionName: "confidentialBalanceOf", args: address ? [address] : undefined, query: { enabled: canReadToken && Boolean(address) } });
  const token = tokenFromMetadata(selectedToken, tokenSymbol, tokenDecimals);
  const validation = useMemo(() => token ? validateEntries(entries, token, PAYROLL_CONTRACTS.multisend) : { entries: {} }, [entries, token]);
  const tokenError = isAddress(tokenAddress) ? undefined : "Enter a valid token address.";
  const accessMessage = tokenError ?? (!isConnected ? "Connect a wallet before preparing a payroll payment." : chainId !== sepolia.id ? "Switch to Sepolia before preparing a payroll payment." : undefined);
  const localOperatorIsValid = operatorExpiresAt !== undefined && operatorExpiresAt > Date.now() / 1000;
  const requiresAuthorization = isOperator !== true && !localOperatorIsValid;
  const blocked = Boolean(accessMessage) || !token;

  useEffect(() => {
    operationRef.current += 1;
    setOperatorExpiresAt(undefined);
    setCheckedBalance(undefined);
    setFlowError(undefined);
    setPayments([]);
    setSending(false);
  }, [address, chainId, tokenAddress]);

  useEffect(() => {
    setCheckedBalance(undefined);
  }, [balanceHandle]);

  useEffect(() => {
    let active = true;
    if (!isConnected || chainId !== sepolia.id || !address || !publicClient) return;
    void publicClient.getLogs({ address: PAYROLL_CONTRACTS.multisend, fromBlock: DEPLOYMENT_BLOCK, toBlock: "latest" }).then((logs) => {
      if (!active) return;
      const sent = logs.flatMap((log) => {
        const payment = decodePayment(log);
        return payment && payment.sender.toLowerCase() === address.toLowerCase() ? [payment] : [];
      });
      setPayments((current) => [...sent, ...current.filter((payment) => !sent.some((record) => record.id === payment.id))]);
    });
    return () => { active = false; };
  }, [address, chainId, isConnected, publicClient]);

  const contextMatches = ({ account, chainId: expectedChainId, token }: PaymentContext) => {
    const current = contextRef.current;
    return current.address === account && current.chainId === expectedChainId && current.tokenAddress.toLowerCase() === token.toLowerCase();
  };

  const updateEntry = (id: string, field: "recipient" | "amount", value: string) => {
    if (sending) return;
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
  };

  const authorize = async () => {
    if (blocked || !selectedToken || !address) return;
    const context = { account: address, chainId: chainId!, token: selectedToken };
    const until = Math.floor(Date.now() / 1000) + 15 * 60;
    const result = await sendWithReceipt("operator", { address: selectedToken, abi: confidentialTokenAbi, functionName: "setOperator", args: [PAYROLL_CONTRACTS.multisend, BigInt(until)] });
    if (result?.receipt && contextMatches(context)) {
      setOperatorExpiresAt(until);
      await refetchOperator();
    }
  };

  const sendPayments = async () => {
    if (blocked || requiresAuthorization || !selectedToken || !address || validation.total === undefined || sending) {
      setShowValidation(true);
      return;
    }
    if (checkedBalance === undefined) {
      setFlowError("Sign to check the private balance before sending a payment.");
      return;
    }
    if (checkedBalance < validation.total) {
      setFlowError("The private balance is lower than the requested total.");
      return;
    }

    const snapshot: FrozenPayment = {
      account: address,
      chainId: chainId!,
      token: selectedToken,
      recipients: entries.map((entry) => entry.recipient as Address),
      amounts: entries.map((entry) => parseTokenAmount(entry.amount, token.decimals)),
    };
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setSending(true);
    setShowValidation(false);
    setFlowError(undefined);
    try {
      const encrypted = await encryptValues(PAYROLL_CONTRACTS.multisend, snapshot.account, snapshot.amounts);
      if (!contextMatches(snapshot)) throw new Error("Wallet, network, or token changed. Review the payment again.");
      const result = await sendWithReceipt("payroll", {
        address: PAYROLL_CONTRACTS.multisend,
        abi: payrollMultisendAbi,
        functionName: "multisend",
        args: [snapshot.token, snapshot.recipients, encrypted.handles, encrypted.proof],
      });
      if (!result) return;
      if (!result.receipt) {
        setFlowError(`Transaction status is unknown. Check ${result.hash} before sending again.`);
        return;
      }
      if (!contextMatches(snapshot)) return;
      const records = result.receipt.logs.map((log) => decodePayment(log)).filter((record): record is PaymentRecord => Boolean(record));
      if (records.length !== snapshot.recipients.length) throw new Error("The receipt did not contain every payment event. Do not resend automatically.");
      setPayments((current) => [...records, ...current.filter((payment) => !records.some((record) => record.id === payment.id))]);
      setEntries(cloneEntries(DEFAULT_ENTRIES));
      setTouched({});
    } catch (cause) {
      if (contextMatches(snapshot)) setFlowError(cause instanceof Error ? cause.message : "Could not prepare the payment.");
    } finally {
      if (operationRef.current === operation) setSending(false);
    }
  };

  return (
    <div className="pb-24">
      <PayrollHeader title="Payroll" />
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-xl text-zinc-100">Payment entries</h2>
          <div className="text-right">
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Requested total</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">{validation.total === undefined || !token ? "Fix entries" : `${formatTokenAmount(validation.total, token.decimals)} ${token.symbol}`}</p>
          </div>
        </div>
        <label className="mt-5 grid gap-1 text-xs text-zinc-400">Payment token address<input value={tokenAddress} onChange={(event) => onTokenAddressChange(event.target.value)} disabled={sending} spellCheck={false} className={inputClass(tokenError)} />{token && <span className="font-mono text-xs text-zinc-500">{token.symbol} · {token.decimals} decimals</span>}</label>
        <div className="mt-6 space-y-3">{entries.map((entry, index) => <PaymentRow key={entry.id} entry={entry} index={index} validation={validation} token={token} showValidation={showValidation} touched={touched[entry.id]} locked={sending} canRemove={entries.length > 1} onChange={updateEntry} onBlur={(id, field) => setTouched((current) => ({ ...current, [id]: { ...current[id], [field]: true } }))} onRemove={(id) => setEntries((current) => current.length > 1 ? current.filter((entry) => entry.id !== id) : current)} />)}</div>
        {showValidation && validation.form && <p className="mt-3 text-sm text-red-300">{validation.form}</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => setEntries((current) => current.length < MAX_ENTRIES ? [...current, { id: `entry-${nextEntryId.current++}`, recipient: "", amount: "" }] : current)} disabled={sending || entries.length >= MAX_ENTRIES} className={secondary}>Add recipient</button><span className="self-center font-mono text-xs text-zinc-500">{entries.length}/{MAX_ENTRIES} entries</span></div>
        <div aria-live="polite" className="mt-7 border-t border-zinc-800 pt-5">
          {accessMessage && <p className="mb-3 text-sm text-yellow-200">{accessMessage}</p>}
          {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
          {flowError && <p className="mb-3 text-sm text-red-300">{flowError}</p>}
          {!blocked && selectedToken && balanceHandle && <PrivateBalance handle={balanceHandle} token={token} onValue={setCheckedBalance} />}
          {requiresAuthorization ? <><p className="mb-3 text-sm text-zinc-300">Authorize the multisend for 15 minutes before sending a payment.</p><button type="button" onClick={authorize} disabled={blocked || pending === "operator"} className={action}>{pending === "operator" ? "Authorizing multisend..." : "Authorize multisend"}</button></> : <button type="button" onClick={sendPayments} disabled={blocked || sending || pending === "payroll"} className={action}>{sending || pending === "payroll" ? "Sending payment..." : "Send payment"}</button>}
        </div>
      </section>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7"><h2 className="text-xl text-zinc-100">Recent sent payments</h2><PaymentsList payments={payments} token={token} received={false} /></section>
    </div>
  );
}

function PrivateBalance({ handle, token, onValue }: { handle: Hex; token?: Token; onValue: (value: bigint) => void }) {
  const decryption = useDecryption();
  const { signTypedDataAsync } = useSignTypedData();
  const version = useSyncExternalStore(decryption.subscribe, decryption.getVersion, decryption.getVersion);
  const [phase, setPhase] = useState<"locked" | "decrypting" | "error">("locked");
  const value = decryption.getCachedDecryption(handle, token?.address ?? PAYROLL_CONTRACTS.demoToken);

  useEffect(() => {
    setPhase("locked");
  }, [handle, version]);

  useEffect(() => {
    if (value !== undefined) onValue(value);
  }, [onValue, value]);

  const decrypt = async () => {
    if (!token) return;
    setPhase("decrypting");
    try {
      await decryption.userDecrypt([{ handle, contractAddress: token.address }], signTypedDataAsync);
      setPhase("locked");
    } catch {
      setPhase("error");
    }
  };

  return <div className="mb-4 flex flex-wrap items-center gap-3"><span className="text-sm text-zinc-300">{value === undefined || !token ? "Private balance locked" : `Private balance: ${formatTokenAmount(value, token.decimals)} ${token.symbol}`}</span>{value === undefined && <button type="button" onClick={decrypt} disabled={!token || phase === "decrypting"} className={secondary}>{phase === "decrypting" ? "Decrypting balance..." : "Sign to check balance"}</button>}{phase === "error" && <span className="text-sm text-red-300">Could not decrypt the balance. Try again.</span>}</div>;
}

function CommunityPayroll() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [historyError, setHistoryError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!isConnected || chainId !== sepolia.id || !address || !publicClient) {
      setPayments([]);
      return;
    }
    void publicClient.getLogs({ address: PAYROLL_CONTRACTS.multisend, fromBlock: DEPLOYMENT_BLOCK, toBlock: "latest" }).then((logs) => {
      if (!active) return;
      const received = logs.flatMap((log) => {
        const payment = decodePayment(log);
        return payment && payment.recipient.toLowerCase() === address.toLowerCase() ? [payment] : [];
      });
      setPayments(received);
      setHistoryError(undefined);
    }).catch(() => {
      if (active) setHistoryError("Could not load payment history. Try again later.");
    });
    return () => { active = false; };
  }, [address, chainId, isConnected, publicClient]);

  return <div className="pb-24"><PayrollHeader title="My payroll" /><section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7"><h2 className="text-xl text-zinc-100">Received payments</h2>{!isConnected && <p className="mt-3 text-sm text-yellow-200">Connect a wallet to view received payments.</p>}{chainId !== undefined && chainId !== sepolia.id && <p className="mt-3 text-sm text-yellow-200">Switch to Sepolia to view received payments.</p>}{historyError && <p className="mt-3 text-sm text-red-300">{historyError}</p>}<PaymentsList payments={payments} received /></section></div>;
}

function PaymentRow({ entry, index, validation, token, showValidation, touched, locked, canRemove, onChange, onBlur, onRemove }: { entry: PaymentEntry; index: number; validation: Validation; token?: Token; showValidation: boolean; touched?: TouchedFields[string]; locked: boolean; canRemove: boolean; onChange: (id: string, field: "recipient" | "amount", value: string) => void; onBlur: (id: string, field: "recipient" | "amount") => void; onRemove: (id: string) => void }) {
  const errors = validation.entries[entry.id];
  const recipientError = (showValidation || touched?.recipient) ? errors?.recipient : undefined;
  const amountError = (showValidation || touched?.amount) ? errors?.amount : undefined;
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="font-mono text-xs text-zinc-500">Payment {index + 1}</span><button type="button" onClick={() => onRemove(entry.id)} disabled={locked || !canRemove} className={`text-xs text-zinc-400 hover:text-yellow-300 disabled:cursor-not-allowed disabled:text-zinc-600 ${focus}`}>Remove</button></div><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]"><label className="grid min-w-0 gap-1 text-xs text-zinc-400">Recipient<input value={entry.recipient} onChange={(event) => onChange(entry.id, "recipient", event.target.value)} onBlur={() => onBlur(entry.id, "recipient")} disabled={locked} spellCheck={false} className={inputClass(recipientError)} /></label><label className="grid min-w-0 gap-1 text-xs text-zinc-400">Amount ({token?.symbol ?? "token"})<input value={entry.amount} onChange={(event) => onChange(entry.id, "amount", event.target.value)} onBlur={() => onBlur(entry.id, "amount")} disabled={locked} inputMode="decimal" className={inputClass(amountError)} /></label></div>{recipientError && <p className="mt-2 text-xs text-red-300">{recipientError}</p>}{amountError && <p className="mt-2 text-xs text-red-300">{amountError}</p>}</div>;
}

function PaymentsList({ payments, token, received = false }: { payments: PaymentRecord[]; token?: Token; received?: boolean }) {
  if (!payments.length) return <p className="mt-5 text-sm text-zinc-500">No payments found.</p>;
  return <ul className="mt-5 divide-y divide-zinc-800">{payments.map((payment) => <PrivatePaymentRow key={payment.id} payment={payment} token={token} received={received} />)}</ul>;
}

function PrivatePaymentRow({ payment, token, received }: { payment: PaymentRecord; token?: Token; received: boolean }) {
  const decryption = useDecryption();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: historicTokenSymbol } = useReadContract({ address: payment.token, abi: confidentialTokenAbi, functionName: "symbol", query: { enabled: !token } });
  const { data: historicTokenDecimals } = useReadContract({ address: payment.token, abi: confidentialTokenAbi, functionName: "decimals", query: { enabled: !token } });
  const displayToken = token ?? tokenFromMetadata(payment.token, historicTokenSymbol, historicTokenDecimals);
  const version = useSyncExternalStore(decryption.subscribe, decryption.getVersion, decryption.getVersion);
  const [phase, setPhase] = useState<"locked" | "decrypting" | "error">("locked");
  const requested = decryption.getCachedDecryption(payment.requestedAmount, PAYROLL_CONTRACTS.multisend);
  const actual = decryption.getCachedDecryption(payment.actualAmount, PAYROLL_CONTRACTS.multisend);
  const hasDetails = requested !== undefined && actual !== undefined;

  useEffect(() => { setPhase("locked"); }, [payment.id, version]);
  const decrypt = async () => {
    setPhase("decrypting");
    try {
      await decryption.userDecrypt([{ handle: payment.requestedAmount, contractAddress: PAYROLL_CONTRACTS.multisend }, { handle: payment.actualAmount, contractAddress: PAYROLL_CONTRACTS.multisend }], signTypedDataAsync);
      setPhase("locked");
    } catch {
      setPhase("error");
    }
  };
  const amount = (value: bigint) => displayToken ? `${formatTokenAmount(value, displayToken.decimals)} ${displayToken.symbol}` : "Private token amount";
  return <li className="grid gap-3 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] sm:items-center">{received ? <span className="text-zinc-300">Received payment</span> : <span className="min-w-0 break-all font-mono text-xs text-zinc-300">{payment.recipient}</span>}<div className="grid gap-3">{hasDetails ? <span className="grid gap-1 font-mono text-xs text-zinc-100"><span>Requested {amount(requested)}</span><span>Actual {amount(actual)}</span><span className={actual === 0n ? "text-yellow-200" : actual === requested ? "text-green-200" : "text-yellow-200"}>{actual === 0n ? "Verified zero" : actual === requested ? "Verified paid" : "Actual amount differs"}</span></span> : <span className="font-mono text-xs text-zinc-500">Private details locked</span>}{phase === "decrypting" ? <span className="text-xs text-yellow-100">Decrypting...</span> : phase === "error" ? <span className="text-xs text-red-300">Could not decrypt this payment. Try again.</span> : !hasDetails && <button type="button" onClick={decrypt} className={secondary}>Sign to view details</button>}</div><a className="font-mono text-xs text-zinc-400 hover:text-yellow-300" href={`https://sepolia.etherscan.io/tx/${payment.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a></li>;
}
