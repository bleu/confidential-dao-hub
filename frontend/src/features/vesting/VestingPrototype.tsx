"use client";

import { useCallback, useReducer, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { shortAddress, formatTimestamp } from "@/lib/format";

import { PrototypeSwitcher } from "./PrototypeSwitcher";
import {
  grantForId,
  grantsForWorkspace,
  isPrototypeVariant,
  type ClaimState,
  type CreationState,
  type MockGrant,
  type PrivateReadState,
  type PrototypeVariant,
  type PrototypeView,
  type PrototypeWorkspace,
  type RefundState,
  type RevocationState,
  zeroFundedAttempt,
} from "./prototype";

type SimulatedWallet = "treasury" | "recipient" | "other";
type ContextField = "wallet" | "chain" | "scope";

type PrototypeState = {
  selectedGrantId: string;
  view: PrototypeView;
  wallet: SimulatedWallet;
  chain: "Sepolia" | "Local mock chain";
  scope: "Vesting v1" | "Different feature";
  contextVersion: number;
  privateRead: PrivateReadState;
  creation: CreationState;
  claim: ClaimState;
  revocation: RevocationState;
  refund: RefundState;
  notice: string;
};

type Action =
  | { type: "selectGrant"; grantId: string }
  | { type: "setView"; view: PrototypeView }
  | { type: "changeContext"; field: ContextField; value: string }
  | { type: "startDecrypt" }
  | { type: "completeDecrypt"; contextVersion: number }
  | { type: "setPrivateRead"; privateRead: PrivateReadState }
  | { type: "setCreation"; creation: CreationState }
  | { type: "setClaim"; claim: ClaimState }
  | { type: "setRevocation"; revocation: RevocationState }
  | { type: "setRefund"; refund: RefundState }
  | { type: "clearNotice" };

const button = "rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:border-yellow-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500";
const primaryButton = "rounded-md border border-yellow-400 bg-yellow-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-yellow-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-800 disabled:text-zinc-500";
const panel = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";
const field = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-400";

function reducer(state: PrototypeState, action: Action): PrototypeState {
  switch (action.type) {
    case "selectGrant":
      return { ...state, selectedGrantId: action.grantId, view: "detail", privateRead: "hidden", notice: "Selected sample grant. Private values are hidden." };
    case "setView":
      return { ...state, view: action.view, notice: "" };
    case "changeContext": {
      const contextVersion = state.contextVersion + 1;
      return {
        ...state,
        [action.field]: action.value,
        contextVersion,
        privateRead: "hidden",
        notice: "Mock context changed. Private values and discovery results were cleared.",
      };
    }
    case "startDecrypt":
      return { ...state, privateRead: "decrypting", notice: "Mock private read is in progress." };
    case "completeDecrypt":
      if (action.contextVersion !== state.contextVersion) return state;
      return { ...state, privateRead: "decrypted", notice: "Sample values are visible for this mock context." };
    case "setPrivateRead":
      return { ...state, privateRead: action.privateRead, notice: action.privateRead === "unavailable" ? "The mock private read is unavailable. This is not a zero balance." : state.notice };
    case "setCreation":
      return { ...state, creation: action.creation, notice: creationNotice(action.creation) };
    case "setClaim":
      return { ...state, claim: action.claim, notice: claimNotice(action.claim) };
    case "setRevocation":
      return { ...state, revocation: action.revocation, notice: revocationNotice(action.revocation) };
    case "setRefund":
      return { ...state, refund: action.refund, notice: refundNotice(action.refund) };
    case "clearNotice":
      return { ...state, notice: "" };
  }
}

function creationNotice(state: CreationState): string {
  return {
    review: "Review the sample grant terms. They become fixed after creation.",
    authorizing: "Mock operator authorization is pending. No wallet request was made.",
    submitting: "Mock encrypted funding is submitting. No transaction was sent.",
    minedAwaitingVerification: "The sample transaction is mined. Funding is still not verified.",
    funded: "Sample funding is privately verified. This is not a real entitlement.",
    zeroFunded: "Private verification found zero funding. Do not show this attempt as a grant.",
    rejected: "The sample transaction was rejected. Retry by creating a new grant.",
  }[state];
}

function claimNotice(state: ClaimState): string {
  return {
    idle: "",
    pending: "Mock claim is pending. Execution-time results would be authoritative.",
    paid: "Sample claim paid. Private accounting was refreshed.",
    zeroPayout: "The sample claim paid zero. Entitlement remains available.",
    rejected: "The sample claim was rejected. No entitlement was consumed.",
  }[state];
}

function revocationNotice(state: RevocationState): string {
  return {
    idle: "",
    preview: "Sample preview: revocation preserves vested entitlement and returns only unvested tokens.",
    pending: "Mock revocation is pending. No transaction was sent.",
    stopped: "Sample vesting is stopped. The recipient can still claim vested tokens.",
  }[state];
}

function refundNotice(state: RefundState): string {
  return {
    idle: "",
    pending: "Mock refund retry is pending.",
    paid: "Sample refund was privately verified. This is not a real transfer.",
    zeroOrFailed: "The sample refund returned zero or failed. Vesting remains stopped and the refund can be retried.",
    rejected: "The sample refund retry was rejected. The outstanding refund remains available.",
  }[state];
}

function initialState(workspace: PrototypeWorkspace): PrototypeState {
  return {
    selectedGrantId: workspace === "dao" ? "GR-1048" : "GR-1048",
    view: "list",
    wallet: workspace === "dao" ? "treasury" : "recipient",
    chain: "Sepolia",
    scope: "Vesting v1",
    contextVersion: 1,
    privateRead: "hidden",
    creation: "review",
    claim: "idle",
    revocation: "idle",
    refund: "idle",
    notice: "",
  };
}

function Heading({ workspace, variant }: { workspace: PrototypeWorkspace; variant: PrototypeVariant }) {
  const isDao = workspace === "dao";
  return (
    <div className="mb-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-yellow-300">
        {isDao ? "DAO dashboard / Vesting" : "Community / My vesting"} / variant {variant}
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-zinc-100">{isDao ? "Confidential grants" : "Your confidential grants"}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
        {isDao ? "Create and manage fixed token grants for this DAO." : "Inspect grants that name this recipient and claim what is available."}
      </p>
    </div>
  );
}

function PrototypeBanner({ state, dispatch }: { state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="mb-6 rounded-xl border border-dashed border-yellow-800 bg-yellow-950/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-yellow-300">THROWAWAY MOCK PROTOTYPE</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-400">Sample data only. No wallet, signature, contract, relayer, indexer, or transaction is used here.</p>
        </div>
        <p className="rounded border border-yellow-800 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-yellow-200">Context v{state.contextVersion}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-zinc-400">Simulate wallet
          <select value={state.wallet} onChange={(event) => dispatch({ type: "changeContext", field: "wallet", value: event.target.value })} className={field}>
            <option value="treasury">Treasury wallet</option>
            <option value="recipient">Recipient wallet</option>
            <option value="other">Other wallet</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">Simulate chain
          <select value={state.chain} onChange={(event) => dispatch({ type: "changeContext", field: "chain", value: event.target.value })} className={field}>
            <option value="Sepolia">Sepolia</option>
            <option value="Local mock chain">Local mock chain</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">Simulate feature scope
          <select value={state.scope} onChange={(event) => dispatch({ type: "changeContext", field: "scope", value: event.target.value })} className={field}>
            <option value="Vesting v1">Vesting v1</option>
            <option value="Different feature">Different feature</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function GrantList({ workspace, selectedGrantId, onSelect, compact = false }: { workspace: PrototypeWorkspace; selectedGrantId: string; onSelect: (id: string) => void; compact?: boolean }) {
  const grants = grantsForWorkspace(workspace);
  return (
    <section aria-label={workspace === "dao" ? "Created by me" : "Received by me"} className={compact ? "" : panel}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{workspace === "dao" ? "Created by me" : "Received by me"}</p>
          <h2 className="mt-1 text-lg text-zinc-100">{grants.length} sample grants</h2>
        </div>
        <span className="text-xs text-zinc-500">Public metadata</span>
      </div>
      <div className="grid gap-2">
        {grants.map((grant) => (
          <button key={grant.id} onClick={() => onSelect(grant.id)} aria-pressed={selectedGrantId === grant.id} className={`rounded-lg border p-3 text-left transition ${selectedGrantId === grant.id ? "border-yellow-500 bg-yellow-400/10" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600"}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-zinc-300">{grant.id}</span>
              {grant.revokedAt ? <span className="text-[10px] uppercase text-amber-300">Stopped</span> : <span className="text-[10px] uppercase text-emerald-300">Active</span>}
            </div>
            <p className="mt-2 text-sm text-zinc-100">{grant.token.symbol}</p>
            <p className="mt-1 text-xs text-zinc-500">{shortAddress(workspace === "dao" ? grant.recipient : grant.treasury)}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function PrivateAmounts({ grant, state, dispatch, beginDecrypt, canInspect }: { grant: MockGrant; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void; canInspect: boolean }) {
  const values = Object.entries(grant.privateAmounts).filter(([name]) => name !== "refundEntitlement" && name !== "refunded" || grant.revokedAt);
  const privateCopy = state.privateRead === "decrypted" ? "Sample private values" : state.privateRead === "decrypting" ? "Reading sample values" : "Values remain encrypted";
  return (
    <section className={`${panel} mt-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Private accounting</p>
          <p className="mt-2 text-sm text-zinc-400">{privateCopy}. Availability is an estimate; execution time decides an actual claim.</p>
        </div>
        {state.privateRead === "hidden" && (canInspect ? <button className={primaryButton} onClick={beginDecrypt}>Read privately (demo)</button> : <span className="text-sm text-zinc-500">Only the grant treasury or recipient can read these values.</span>)}
        {state.privateRead === "decrypting" && <span className="rounded border border-yellow-800 px-3 py-2 text-sm text-yellow-200">Decrypting sample...</span>}
        {state.privateRead === "unavailable" && canInspect && <button className={button} onClick={beginDecrypt}>Try sample read again</button>}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {values.map(([name, value]) => (
          <div key={name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-xs capitalize text-zinc-500">{name.replace(/([A-Z])/g, " $1")}</p>
            <p className="mt-2 font-mono text-sm text-zinc-100">{state.privateRead === "decrypted" ? value : "Encrypted"}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={button} onClick={() => dispatch({ type: "setPrivateRead", privateRead: "unavailable" })}>Simulate unavailable read</button>
        <button className={button} onClick={() => dispatch({ type: "setPrivateRead", privateRead: "hidden" })}>Hide sample values</button>
      </div>
    </section>
  );
}

function PublicGrantFacts({ grant }: { grant: MockGrant }) {
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{grant.id} / public grant facts</p>
          <h2 className="mt-2 text-xl text-zinc-100">{grant.token.symbol}</h2>
        </div>
        <span className={`rounded border px-2 py-1 text-xs ${grant.revokedAt ? "border-amber-800 text-amber-300" : "border-emerald-800 text-emerald-300"}`}>{grant.revokedAt ? "Vesting stopped" : "Vesting active"}</span>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <Fact label="Treasury" value={shortAddress(grant.treasury)} />
        <Fact label="Recipient" value={shortAddress(grant.recipient)} />
        <Fact label="Token" value={grant.token.configured ? grant.token.symbol : `${grant.token.symbol} (${shortAddress(grant.token.address)})`} />
        <Fact label="Schedule" value={`${formatTimestamp(grant.start)} - ${formatTimestamp(grant.end)}`} />
        <Fact label="Cliff" value={grant.cliff ? formatTimestamp(grant.cliff) : "No cliff"} />
        <Fact label="Revocability" value={grant.revocable ? "Revocable" : "Not revocable"} />
        {grant.revokedAt && <Fact label="Stopped at" value={formatTimestamp(grant.revokedAt)} />}
      </dl>
      <p className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-5 text-zinc-400">{grant.note}</p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 font-mono text-xs text-zinc-200">{value}</dd></div>;
}

function CreationPanel({ state, dispatch }: { state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  const [draft, setDraft] = useState({ recipient: "0x0a731a8900000000000000000000000000008412", allocation: "12,000", start: "2026-10-01", end: "2030-10-01", cliff: "2027-10-01", revocable: "yes" });
  const isReview = state.creation === "review";
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Create sample grant</p>
          <h2 className="mt-2 text-xl text-zinc-100">Review immutable terms</h2>
        </div>
        <button className={button} onClick={() => dispatch({ type: "setView", view: "list" })}>Back to grants</button>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">The form is simulated. Allocation, recipient, schedule, token, and revocability cannot be changed after a real grant is created.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">Recipient<input value={draft.recipient} onChange={(event) => setDraft({ ...draft, recipient: event.target.value })} className={field} /></label>
        <label className="text-xs text-zinc-400">Configured token<select className={field}><option>cUSDC</option><option>cUSDT</option></select></label>
        <label className="text-xs text-zinc-400">Allocation<input value={draft.allocation} onChange={(event) => setDraft({ ...draft, allocation: event.target.value })} className={field} /></label>
        <label className="text-xs text-zinc-400">Revocability<select value={draft.revocable} onChange={(event) => setDraft({ ...draft, revocable: event.target.value })} className={field}><option value="yes">Revocable</option><option value="no">Not revocable</option></select></label>
        <label className="text-xs text-zinc-400">Start<input type="date" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} className={field} /></label>
        <label className="text-xs text-zinc-400">End<input type="date" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} className={field} /></label>
        <label className="text-xs text-zinc-400 sm:col-span-2">Optional cliff<input type="date" value={draft.cliff} onChange={(event) => setDraft({ ...draft, cliff: event.target.value })} className={field} /></label>
      </div>
      <p className="mt-4 rounded-lg border border-yellow-900 bg-yellow-950/30 p-3 text-xs leading-5 text-yellow-100">Sample backdated-start preview: 2,000 cUSDC would already be vested after private funding verification. A future cliff still gates any claim.</p>
      {isReview ? <div className="mt-5 flex flex-wrap gap-3"><button className={primaryButton} onClick={() => dispatch({ type: "setCreation", creation: "authorizing" })}>Authorize token (demo)</button><button className={button} onClick={() => dispatch({ type: "setCreation", creation: "rejected" })}>Simulate rejection</button></div> : <CreationFlow state={state} dispatch={dispatch} />}
    </section>
  );
}

function CreationFlow({ state, dispatch }: { state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  const next: Partial<Record<CreationState, { label: string; state: CreationState }>> = {
    authorizing: { label: "Authorization complete (demo)", state: "submitting" },
    submitting: { label: "Mark mined (demo)", state: "minedAwaitingVerification" },
    minedAwaitingVerification: { label: "Verify funding privately (demo)", state: "funded" },
    rejected: { label: "Retry as new grant", state: "review" },
    zeroFunded: { label: "Retry as new grant", state: "review" },
  };
  const action = next[state.creation];
  return (
    <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="font-mono text-xs text-yellow-300">Sample state: {state.creation}</p>
      {action && <button className={`${primaryButton} mt-3`} onClick={() => dispatch({ type: "setCreation", creation: action.state })}>{action.label}</button>}
      {state.creation === "minedAwaitingVerification" && <button className={`${button} mt-3 ml-2`} onClick={() => dispatch({ type: "setCreation", creation: "zeroFunded" })}>Verify zero funded</button>}
      {state.creation === "funded" && <p className="mt-3 text-sm text-emerald-300">Sample funded grant created. It is not a real entitlement.</p>}
      {state.creation === "zeroFunded" && <div className="mt-3 rounded border border-amber-900 p-3 text-xs text-amber-200">{zeroFundedAttempt.id}: {zeroFundedAttempt.result}. It stays out of active grants.</div>}
    </div>
  );
}

function ClaimPanel({ state, dispatch }: { state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  return (
    <section className={`${panel} mt-5`}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Recipient action</p>
      <h2 className="mt-2 text-xl text-zinc-100">Claim available</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Only the fixed recipient can claim. This mock action does not move funds.</p>
      {state.wallet !== "recipient" ? <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-400">This mock wallet is not the fixed recipient, so it cannot claim.</p> : state.claim === "idle" ? <button className={`${primaryButton} mt-4`} onClick={() => dispatch({ type: "setClaim", claim: "pending" })}>Claim sample available amount</button> : (
        <div className="mt-4 flex flex-wrap gap-2">
          {state.claim === "pending" && <><button className={primaryButton} onClick={() => dispatch({ type: "setClaim", claim: "paid" })}>Simulate paid</button><button className={button} onClick={() => dispatch({ type: "setClaim", claim: "zeroPayout" })}>Simulate zero payout</button><button className={button} onClick={() => dispatch({ type: "setClaim", claim: "rejected" })}>Simulate rejection</button></>}
          {state.claim !== "pending" && <button className={button} onClick={() => dispatch({ type: "setClaim", claim: "idle" })}>Reset sample claim</button>}
        </div>
      )}
    </section>
  );
}

function TreasuryActions({ grant, state, dispatch }: { grant: MockGrant; state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  if (!grant.revocable) return <section className={`${panel} mt-5`}><p className="text-sm text-zinc-400">This sample grant is not revocable. Its fixed terms do not allow a treasury action.</p></section>;
  if (state.wallet !== "treasury") return <section className={`${panel} mt-5`}><p className="text-sm text-zinc-400">This mock wallet is not the fixed treasury, so it cannot revoke or retry the refund.</p></section>;
  return (
    <section className={`${panel} mt-5`}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Treasury action</p>
      <h2 className="mt-2 text-xl text-zinc-100">{grant.revokedAt || state.revocation === "stopped" ? "Refund progress" : "Revoke grant"}</h2>
      {!grant.revokedAt && state.revocation === "idle" && <button className={`${primaryButton} mt-4`} onClick={() => dispatch({ type: "setRevocation", revocation: "preview" })}>Preview revocation</button>}
      {state.revocation === "preview" && <div className="mt-4"><p className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">Sample only: unvested tokens return to the treasury. Vested but unclaimed tokens remain claimable by the recipient.</p><div className="mt-3 flex flex-wrap gap-2"><button className={primaryButton} onClick={() => dispatch({ type: "setRevocation", revocation: "pending" })}>Revoke sample grant</button><button className={button} onClick={() => dispatch({ type: "setRevocation", revocation: "idle" })}>Cancel</button></div></div>}
      {state.revocation === "pending" && <button className={`${primaryButton} mt-4`} onClick={() => dispatch({ type: "setRevocation", revocation: "stopped" })}>Mark stopped (demo)</button>}
      {(grant.revokedAt || state.revocation === "stopped") && <RefundActions state={state} dispatch={dispatch} />}
    </section>
  );
}

function RefundActions({ state, dispatch }: { state: PrototypeState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-sm text-zinc-300">Outstanding refund stays private. A failed refund does not restart vesting.</p>
      {state.refund === "idle" && <button className={`${primaryButton} mt-3`} onClick={() => dispatch({ type: "setRefund", refund: "pending" })}>Retry refund (demo)</button>}
      {state.refund === "pending" && <div className="mt-3 flex flex-wrap gap-2"><button className={primaryButton} onClick={() => dispatch({ type: "setRefund", refund: "paid" })}>Simulate paid</button><button className={button} onClick={() => dispatch({ type: "setRefund", refund: "zeroOrFailed" })}>Simulate zero or failed</button><button className={button} onClick={() => dispatch({ type: "setRefund", refund: "rejected" })}>Simulate rejection</button></div>}
      {["zeroOrFailed", "rejected"].includes(state.refund) && <button className={`${button} mt-3`} onClick={() => dispatch({ type: "setRefund", refund: "idle" })}>Prepare another retry</button>}
    </div>
  );
}

function Detail({ workspace, state, dispatch, beginDecrypt }: { workspace: PrototypeWorkspace; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void }) {
  const grant = grantForId(state.selectedGrantId);
  const canInspect = workspace === "dao" ? state.wallet === "treasury" : state.wallet === "recipient";
  return (
    <div>
      <PublicGrantFacts grant={grant} />
      <PrivateAmounts grant={grant} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} canInspect={canInspect} />
      {workspace === "dao" ? <TreasuryActions grant={grant} state={state} dispatch={dispatch} /> : <ClaimPanel state={state} dispatch={dispatch} />}
    </div>
  );
}

function Operations({ workspace, state, dispatch, beginDecrypt }: { workspace: PrototypeWorkspace; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void }) {
  if (workspace === "dao" && state.view === "create") return <CreationPanel state={state} dispatch={dispatch} />;
  return <Detail workspace={workspace} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} />;
}

function VariantA({ workspace, state, dispatch, beginDecrypt }: { workspace: PrototypeWorkspace; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_230px]">
      <div className="space-y-5">
        <GrantList workspace={workspace} selectedGrantId={state.selectedGrantId} onSelect={(grantId) => dispatch({ type: "selectGrant", grantId })} />
        {workspace === "dao" && <section className={panel}>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Grant actions</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Create a new sample grant separately from the selected ongoing grant.</p>
          <button className={`${primaryButton} mt-4 w-full`} onClick={() => dispatch({ type: "setView", view: "create" })}>Create sample grant</button>
        </section>}
      </div>
      <div><Operations workspace={workspace} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} /></div>
      <aside className={panel}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Action status</p>
        <dl className="mt-4 grid gap-4 text-sm"><Fact label="Private read" value={state.privateRead} /><Fact label="Funding" value={state.creation} /><Fact label="Claim" value={state.claim} /><Fact label="Revocation" value={state.revocation} /><Fact label="Refund" value={state.refund} /></dl>
      </aside>
    </div>
  );
}

function VariantB({ workspace, state, dispatch, beginDecrypt }: { workspace: PrototypeWorkspace; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void }) {
  const labels = workspace === "dao" ? ["Terms", "Authorize", "Verify funding", "Manage grant"] : ["Public terms", "Read privately", "Estimate", "Claim"];
  return (
    <div className="space-y-5">
      <ol className="grid gap-3 sm:grid-cols-4">{labels.map((label, index) => <li key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"><p className="font-mono text-xs text-yellow-300">0{index + 1}</p><p className="mt-3 text-sm text-zinc-200">{label}</p></li>)}</ol>
      {workspace === "dao" && <div className="flex justify-end"><button className={primaryButton} onClick={() => dispatch({ type: "setView", view: "create" })}>Start sample grant</button></div>}
      {state.view === "list" ? <GrantList workspace={workspace} selectedGrantId={state.selectedGrantId} onSelect={(grantId) => dispatch({ type: "selectGrant", grantId })} /> : <Operations workspace={workspace} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} />}
      {state.view !== "list" && <GrantList workspace={workspace} selectedGrantId={state.selectedGrantId} onSelect={(grantId) => dispatch({ type: "selectGrant", grantId })} compact />}
    </div>
  );
}

function VariantC({ workspace, state, dispatch, beginDecrypt }: { workspace: PrototypeWorkspace; state: PrototypeState; dispatch: React.Dispatch<Action>; beginDecrypt: () => void }) {
  const urgent = workspace === "dao" ? ["Verify a mined funding result", "Retry outstanding refund"] : ["Read a private grant", "Claim estimated available tokens"];
  return (
    <div className="space-y-5">
      <section className={panel}><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Action inbox</p><h2 className="mt-2 text-xl text-zinc-100">What needs attention</h2></div>{workspace === "dao" && <button className={primaryButton} onClick={() => dispatch({ type: "setView", view: "create" })}>Create sample grant</button>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2">{urgent.map((item, index) => <button key={item} onClick={() => index === 0 && dispatch({ type: "setView", view: "detail" })} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-left text-sm text-zinc-200 hover:border-yellow-400"><span className="font-mono text-xs text-yellow-300">0{index + 1}</span><p className="mt-2">{item}</p></button>)}</div></section>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><GrantList workspace={workspace} selectedGrantId={state.selectedGrantId} onSelect={(grantId) => dispatch({ type: "selectGrant", grantId })} /> <Operations workspace={workspace} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} /></div>
    </div>
  );
}

export function VestingPrototype({ workspace }: { workspace: PrototypeWorkspace }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawVariant = searchParams.get("variant");
  const variant = isPrototypeVariant(rawVariant) ? rawVariant : "A";
  const [state, dispatch] = useReducer(reducer, workspace, initialState);

  const changeVariant = useCallback((next: PrototypeVariant) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const beginDecrypt = useCallback(() => {
    const contextVersion = state.contextVersion;
    dispatch({ type: "startDecrypt" });
    window.setTimeout(() => dispatch({ type: "completeDecrypt", contextVersion }), 650);
  }, [state.contextVersion]);

  const CurrentVariant = variant === "A" ? VariantA : variant === "B" ? VariantB : VariantC;

  return (
    <div className="pb-24">
      <Heading workspace={workspace} variant={variant} />
      <PrototypeBanner state={state} dispatch={dispatch} />
      <CurrentVariant workspace={workspace} state={state} dispatch={dispatch} beginDecrypt={beginDecrypt} />
      {state.notice && <div role="status" className="mt-5 rounded-lg border border-yellow-900 bg-yellow-950/30 p-4 text-sm leading-6 text-yellow-100"><div className="flex items-start justify-between gap-3"><p>{state.notice}</p><button aria-label="Dismiss notice" className="text-yellow-200 hover:text-white" onClick={() => dispatch({ type: "clearNotice" })}>x</button></div></div>}
      <details className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400"><summary className="cursor-pointer font-mono text-zinc-300">Mock state inspector</summary><pre className="mt-4 overflow-auto text-[11px] leading-5">{JSON.stringify({ workspace, variant, view: state.view, selectedGrantId: state.selectedGrantId, wallet: state.wallet, chain: state.chain, scope: state.scope, contextVersion: state.contextVersion, privateRead: state.privateRead, creation: state.creation, claim: state.claim, revocation: state.revocation, refund: state.refund, privateAmounts: state.privateRead === "decrypted" ? "sample values visible" : "redacted" }, null, 2)}</pre></details>
      <PrototypeSwitcher variant={variant} onChange={changeVariant} />
    </div>
  );
}
