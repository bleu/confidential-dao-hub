"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { isCurrentMockPrivateRead, mockPaymentPrivateReadScope, type PrivateRead } from "./mockPrivateState";
import { CUSDT, DEFAULT_ENTRIES, DEMO_RECEIVER, FUNDED_SENDER, MULTISEND_ADDRESS } from "./mock";
import { type SentPayment, usePayrollLedger } from "./PayrollDemoLedger";
import {
  formatTokenAmount,
  hasEnoughBalance,
  MAX_ENTRIES,
  parseTokenAmount,
  type PaymentEntry,
  type Validation,
  validateEntries,
} from "./model";

type Workspace = "dao" | "community";
type PaymentStatus = "editing" | "checking-balance" | "approving" | "sending" | "verifying" | "complete";
type TouchedFields = Record<string, { recipient?: boolean; amount?: boolean }>;
type FrozenPayment = {
  id: string;
  entries: Array<PaymentEntry & { requested: bigint }>;
  total: bigint;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400";
const action = `inline-flex min-h-11 items-center justify-center rounded-md bg-yellow-300 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 ${focus}`;
const secondary = `inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500 ${focus}`;
const inputClass = (error?: string) => `min-h-11 min-w-0 w-full rounded-md border bg-zinc-950 px-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 ${error ? "border-red-400" : "border-zinc-700"} ${focus}`;

function cloneEntries(entries: PaymentEntry[]) {
  return entries.map((entry) => ({ ...entry }));
}

function isBusy(status: PaymentStatus) {
  return status === "checking-balance" || status === "approving" || status === "sending" || status === "verifying";
}

function flowLabel(status: PaymentStatus) {
  if (status === "checking-balance") return "Checking balance...";
  if (status === "approving") return "Approving...";
  if (status === "sending") return "Sending...";
  if (status === "verifying") return "Verifying payment...";
  return "Sign to check balance";
}

function flowMessage(status: PaymentStatus) {
  if (status === "checking-balance") return "Checking mock balance...";
  if (status === "approving") return "Approving mock token...";
  if (status === "sending") return "Sending mock payments...";
  if (status === "verifying") return "Confirmed. Verifying payment...";
  return null;
}

function privateResult(payment: SentPayment) {
  if (payment.verification === "pending") return "Awaiting verification";
  return payment.actual === payment.requested ? "Verified paid" : "Verified zero";
}

function privateResultClass(payment: SentPayment) {
  if (payment.verification === "pending") return "text-zinc-300";
  return payment.actual === payment.requested ? "text-green-200" : "text-yellow-200";
}

function usePrivateRead(scope: string) {
  const [privateRead, setPrivateRead] = useState<PrivateRead>({ scope, phase: "locked" });
  const version = useRef(0);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  const clear = () => {
    version.current += 1;
    clearTimers();
    setPrivateRead({ scope, phase: "locked" });
  };

  useEffect(() => {
    version.current += 1;
    clearTimers();
    setPrivateRead({ scope, phase: "locked" });

    return () => {
      version.current += 1;
      clearTimers();
    };
  }, [scope]);

  const request = () => {
    version.current += 1;
    clearTimers();
    setPrivateRead({ scope, phase: "awaiting-signature" });
  };

  const confirm = () => {
    if (privateRead.scope !== scope || privateRead.phase !== "awaiting-signature") return;
    const currentVersion = version.current;
    setPrivateRead({ scope, phase: "decrypting" });
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((current) => current !== timer);
      if (isCurrentMockPrivateRead({ scope, phase: "decrypting" }, scope, currentVersion, version.current)) {
        setPrivateRead({ scope, phase: "revealed" });
      }
    }, 500);
    timers.current.push(timer);
  };

  return {
    privateRead,
    detailsVisible: privateRead.scope === scope && privateRead.phase === "revealed",
    request,
    confirm,
    clear,
  };
}

export function PayrollDemo({ workspace }: { workspace: Workspace }) {
  return workspace === "dao" ? <DaoPayrollDemo /> : <CommunityPayrollDemo />;
}

function PayrollHeader({ title }: { title: string }) {
  return (
    <section className="border-b border-zinc-800 pb-5">
      <h1 className="text-3xl font-medium tracking-tight text-zinc-100">{title}</h1>
    </section>
  );
}

function DaoPayrollDemo() {
  const { daoPayments, recordPayments, verifyPayments } = usePayrollLedger();
  const [entries, setEntries] = useState(() => cloneEntries(DEFAULT_ENTRIES));
  const [status, setStatus] = useState<PaymentStatus>("editing");
  const [payment, setPayment] = useState<FrozenPayment | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [insufficientBalance, setInsufficientBalance] = useState<string | null>(null);
  const [privateReadSession, setPrivateReadSession] = useState(0);
  const paymentStarted = useRef(false);
  const nextEntryId = useRef(DEFAULT_ENTRIES.length + 1);
  const operationVersion = useRef(0);
  const operationTimers = useRef<number[]>([]);

  useEffect(() => () => {
    operationVersion.current += 1;
    operationTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const validation = useMemo(() => validateEntries(entries, CUSDT, MULTISEND_ADDRESS), [entries]);
  const locked = status !== "editing";
  const total = payment?.total ?? validation.total;

  const clearOperationTimers = () => {
    operationTimers.current.forEach((timer) => window.clearTimeout(timer));
    operationTimers.current = [];
  };

  const scheduleOperation = (version: number, callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      operationTimers.current = operationTimers.current.filter((current) => current !== timer);
      if (operationVersion.current === version) callback();
    }, delay);
    operationTimers.current.push(timer);
  };

  const cancelActivePayment = () => {
    operationVersion.current += 1;
    clearOperationTimers();
    paymentStarted.current = false;
    setPayment(null);
    setStatus("editing");
  };

  const updateEntry = (id: string, field: "recipient" | "amount", value: string) => {
    if (locked) return;
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
    setInsufficientBalance(null);
  };

  const touchField = (id: string, field: "recipient" | "amount") => {
    setTouched((current) => ({ ...current, [id]: { ...current[id], [field]: true } }));
  };

  const addEntry = () => {
    if (locked || entries.length >= MAX_ENTRIES) return;
    const id = `entry-${nextEntryId.current++}`;
    setEntries((current) => [...current, { id, recipient: "", amount: "" }]);
    setInsufficientBalance(null);
  };

  const removeEntry = (id: string) => {
    if (locked || entries.length <= 1) return;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setInsufficientBalance(null);
  };

  const sendPayments = () => {
    if (locked || paymentStarted.current) return;
    if (validation.total === undefined) {
      setShowValidation(true);
      return;
    }

    const paymentId = `mock-payment-${Date.now()}`;
    const frozenPayment = {
      id: paymentId,
      entries: entries.map((entry) => ({ ...entry, requested: parseTokenAmount(entry.amount, CUSDT.decimals) })),
      total: validation.total,
    };
    const version = operationVersion.current + 1;

    paymentStarted.current = true;
    operationVersion.current = version;
    setPayment(frozenPayment);
    setShowValidation(false);
    setInsufficientBalance(null);
    setStatus("checking-balance");

    scheduleOperation(version, () => {
      if (!hasEnoughBalance(frozenPayment.total, FUNDED_SENDER.balance)) {
        const amountNeeded = frozenPayment.total - FUNDED_SENDER.balance;
        paymentStarted.current = false;
        setPayment(null);
        setStatus("editing");
        setInsufficientBalance(`Mock balance is ${formatTokenAmount(FUNDED_SENDER.balance, CUSDT.decimals)} ${CUSDT.symbol}. Need ${formatTokenAmount(amountNeeded, CUSDT.decimals)} more.`);
        return;
      }

      setStatus("approving");
      scheduleOperation(version, () => {
        setStatus("sending");
        scheduleOperation(version, () => {
          recordPayments(frozenPayment.id, frozenPayment.entries);
          setStatus("verifying");
          scheduleOperation(version, () => {
            verifyPayments(frozenPayment.id);
            setStatus("complete");
          }, 700);
        }, 700);
      }, 500);
    }, 600);
  };

  const startNewPayment = () => {
    cancelActivePayment();
    setPrivateReadSession((current) => current + 1);
    setEntries(cloneEntries(DEFAULT_ENTRIES));
    setShowValidation(false);
    setTouched({});
    setInsufficientBalance(null);
  };

  return (
    <div className="pb-24">
      <PayrollHeader title="Payroll" />
      <SendView
        entries={entries}
        validation={validation}
        showValidation={showValidation}
        touched={touched}
        locked={locked}
        total={total}
        status={status}
        insufficientBalance={insufficientBalance}
        payments={daoPayments}
        privateReadSession={privateReadSession}
        onChange={updateEntry}
        onBlur={touchField}
        onAdd={addEntry}
        onRemove={removeEntry}
        onSend={sendPayments}
        onNewPayment={startNewPayment}
      />
    </div>
  );
}

function CommunityPayrollDemo() {
  const { receiverPayments } = usePayrollLedger();

  return (
    <div className="pb-24">
      <PayrollHeader title="My payroll" />
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl text-zinc-100">Received payments</h2>
            <p className="mt-1 break-all font-mono text-xs text-zinc-400">{DEMO_RECEIVER.address}</p>
          </div>
        </div>
        <PaymentsList payments={receiverPayments} viewerScope={`receive:${DEMO_RECEIVER.address.toLowerCase()}`} received />
      </section>
    </div>
  );
}

function SendView({ entries, validation, showValidation, touched, locked, total, status, insufficientBalance, payments, privateReadSession, onChange, onBlur, onAdd, onRemove, onSend, onNewPayment }: {
  entries: PaymentEntry[];
  validation: Validation;
  showValidation: boolean;
  touched: TouchedFields;
  locked: boolean;
  total?: bigint;
  status: PaymentStatus;
  insufficientBalance: string | null;
  payments: SentPayment[];
  privateReadSession: number;
  onChange: (id: string, field: "recipient" | "amount", value: string) => void;
  onBlur: (id: string, field: "recipient" | "amount") => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  onNewPayment: () => void;
}) {
  const busy = isBusy(status);
  const message = flowMessage(status);

  return (
    <>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-xl text-zinc-100">Payment entries</h2>
          <div className="text-right">
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Requested total</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">{total === undefined ? "Fix entries" : `${formatTokenAmount(total, CUSDT.decimals)} ${CUSDT.symbol}`}</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {entries.map((entry, index) => <PaymentRow key={entry.id} entry={entry} index={index} validation={validation} showValidation={showValidation} touched={touched[entry.id]} locked={locked} canRemove={entries.length > 1} onChange={onChange} onBlur={onBlur} onRemove={onRemove} />)}
        </div>

        {showValidation && validation.form && <p className="mt-3 text-sm text-red-300">{validation.form}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={onAdd} disabled={locked || entries.length >= MAX_ENTRIES} className={secondary}>Add recipient</button>
          <span className="self-center font-mono text-xs text-zinc-500">{entries.length}/{MAX_ENTRIES} entries</span>
        </div>

        <div aria-live="polite" className="mt-7 border-t border-zinc-800 pt-5">
          {status === "complete" ? <>
            <p className="text-sm text-zinc-200">Verified. Sign on a payment to view its details.</p>
            <button type="button" onClick={onNewPayment} className={`mt-4 ${secondary}`}>New payment</button>
          </> : <>
            {message && <p className="mb-3 text-sm text-yellow-100">{message}</p>}
            {insufficientBalance && <p className="mb-3 text-sm text-yellow-200">{insufficientBalance}</p>}
            <button type="button" onClick={onSend} disabled={busy} className={action}>{flowLabel(status)}</button>
          </>}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
        <h2 className="text-xl text-zinc-100">Recent sent payments</h2>
        <PaymentsList payments={payments} viewerScope={`send:${FUNDED_SENDER.address.toLowerCase()}:session:${privateReadSession}`} />
      </section>
    </>
  );
}

function PaymentRow({ entry, index, validation, showValidation, touched, locked, canRemove, onChange, onBlur, onRemove }: {
  entry: PaymentEntry;
  index: number;
  validation: Validation;
  showValidation: boolean;
  touched?: TouchedFields[string];
  locked: boolean;
  canRemove: boolean;
  onChange: (id: string, field: "recipient" | "amount", value: string) => void;
  onBlur: (id: string, field: "recipient" | "amount") => void;
  onRemove: (id: string) => void;
}) {
  const errors = validation.entries[entry.id];
  const recipientError = (showValidation || touched?.recipient) ? errors?.recipient : undefined;
  const amountError = (showValidation || touched?.amount) ? errors?.amount : undefined;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-zinc-500">Payment {index + 1}</span>
        <button type="button" onClick={() => onRemove(entry.id)} disabled={locked || !canRemove} className={`text-xs text-zinc-400 hover:text-yellow-300 disabled:cursor-not-allowed disabled:text-zinc-600 ${focus}`}>Remove</button>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="grid min-w-0 gap-1 text-xs text-zinc-400">Recipient<input value={entry.recipient} onChange={(event) => onChange(entry.id, "recipient", event.target.value)} onBlur={() => onBlur(entry.id, "recipient")} disabled={locked} spellCheck={false} className={inputClass(recipientError)} aria-describedby={recipientError ? `${entry.id}-recipient-error` : undefined} /></label>
        <label className="grid min-w-0 gap-1 text-xs text-zinc-400">Amount ({CUSDT.symbol})<input value={entry.amount} onChange={(event) => onChange(entry.id, "amount", event.target.value)} onBlur={() => onBlur(entry.id, "amount")} disabled={locked} inputMode="decimal" className={inputClass(amountError)} aria-describedby={amountError ? `${entry.id}-amount-error` : undefined} /></label>
      </div>
      {recipientError && <p id={`${entry.id}-recipient-error`} className="mt-2 text-xs text-red-300">{recipientError}</p>}
      {amountError && <p id={`${entry.id}-amount-error`} className="mt-2 text-xs text-red-300">{amountError}</p>}
    </div>
  );
}

function PrivateDetailsGate({ privateRead, onRequestDetails, onConfirmDetails, onCancelDetails }: {
  privateRead: PrivateRead;
  onRequestDetails: () => void;
  onConfirmDetails: () => void;
  onCancelDetails: () => void;
}) {
  if (privateRead.phase === "revealed") return <p className="text-xs text-green-200">Private details shown.</p>;
  if (privateRead.phase === "decrypting") return <p aria-live="polite" className="text-xs text-yellow-100">Decrypting...</p>;
  if (privateRead.phase === "awaiting-signature") {
    return <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="text-xs text-yellow-100">Waiting for signature...</span>
      <button type="button" onClick={onConfirmDetails} className={secondary}>Sign</button>
      <button type="button" onClick={onCancelDetails} className={secondary}>Cancel</button>
    </div>;
  }
  return <button type="button" onClick={onRequestDetails} className={secondary}>Sign to view details</button>;
}

function PaymentsList({ payments, viewerScope, received = false }: {
  payments: SentPayment[];
  viewerScope: string;
  received?: boolean;
}) {
  return (
    <ul className="mt-5 divide-y divide-zinc-800">
      {payments.map((payment) => <PrivatePaymentRow key={payment.id} payment={payment} viewerScope={viewerScope} received={received} />)}
    </ul>
  );
}

function PrivatePaymentRow({ payment, viewerScope, received }: {
  payment: SentPayment;
  viewerScope: string;
  received: boolean;
}) {
  const scope = mockPaymentPrivateReadScope(viewerScope, payment.id);
  const privateDetails = usePrivateRead(scope);

  return (
    <li className="grid gap-3 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] sm:items-center">
      {received ? <span className="text-zinc-300">Received payment</span> : <span className="min-w-0 break-all font-mono text-xs text-zinc-300">{payment.recipient}</span>}
      <div className="grid gap-3">
        {privateDetails.detailsVisible ? <PrivatePaymentDetails payment={payment} /> : <span className="font-mono text-xs text-zinc-500">Private details locked</span>}
        <PrivateDetailsGate privateRead={privateDetails.privateRead} onRequestDetails={privateDetails.request} onConfirmDetails={privateDetails.confirm} onCancelDetails={privateDetails.clear} />
      </div>
      <time className="text-sm text-zinc-400 sm:text-right">{payment.date}</time>
    </li>
  );
}

function PrivatePaymentDetails({ payment }: { payment: SentPayment }) {
  if (payment.verification === "pending") {
    return <span className="grid gap-1 font-mono text-xs text-zinc-300"><span>Requested {formatTokenAmount(payment.requested, CUSDT.decimals)} {CUSDT.symbol}</span><span>Actual {formatTokenAmount(payment.actual ?? 0n, CUSDT.decimals)} {CUSDT.symbol}</span><span>Awaiting verification</span></span>;
  }

  return <span className="grid gap-1 font-mono text-xs text-zinc-100"><span>Requested {formatTokenAmount(payment.requested, CUSDT.decimals)} {CUSDT.symbol}</span><span>Actual {formatTokenAmount(payment.actual ?? 0n, CUSDT.decimals)} {CUSDT.symbol}</span><span className={privateResultClass(payment)}>{privateResult(payment)}</span></span>;
}
