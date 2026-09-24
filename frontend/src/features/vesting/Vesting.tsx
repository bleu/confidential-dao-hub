"use client";

import { type KeyboardEvent, useState } from "react";

import { shortAddress } from "@/lib/format";

import {
  grantStatusLabel,
  grantsForWorkspace,
  type VestingGrant,
  type VestingWorkspace,
} from "./data";

const panel = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";
const field = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400";
const disabledButton = "cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500";

type DaoTab = "create" | "ongoing";

export function Vesting({ workspace }: { workspace: VestingWorkspace }) {
  const grants = grantsForWorkspace(workspace);
  const [selectedGrantId, setSelectedGrantId] = useState(grants[0]?.id ?? "");
  const [daoTab, setDaoTab] = useState<DaoTab>("create");
  const selectedGrant = grants.find((grant) => grant.id === selectedGrantId) ?? grants[0];

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-yellow-300">{workspace === "dao" ? "DAO dashboard / Vesting" : "Community / My vesting"}</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-zinc-100">{workspace === "dao" ? "Vesting" : "My vesting"}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{workspace === "dao" ? "Create grants and review the grants funded by this treasury." : "Review grants that name this wallet as their recipient."}</p>
      </header>

      <aside className="rounded-lg border border-yellow-900 bg-yellow-950/30 p-4 text-sm leading-6 text-yellow-100">
        Preview data only. Wallet, contract, private reads, and actions are not connected yet.
      </aside>

      {workspace === "dao" ? (
        <>
          <DaoTabs selected={daoTab} onChange={setDaoTab} />
          {daoTab === "create" ? <CreateGrant /> : <GrantWorkbench workspace={workspace} grants={grants} selectedGrant={selectedGrant} onSelect={setSelectedGrantId} />}
        </>
      ) : (
        <GrantWorkbench workspace={workspace} grants={grants} selectedGrant={selectedGrant} onSelect={setSelectedGrantId} />
      )}
    </div>
  );
}

function DaoTabs({ selected, onChange }: { selected: DaoTab; onChange: (tab: DaoTab) => void }) {
  const tabs: { id: DaoTab; label: string }[] = [
    { id: "create", label: "Create vesting contract" },
    { id: "ongoing", label: "Ongoing vestings" },
  ];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`vesting-${nextTab.id}-tab`)?.focus());
  }

  return (
    <div className="border-b border-zinc-800" role="tablist" aria-label="DAO vesting work">
      {tabs.map((tab, index) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            id={`vesting-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`vesting-${tab.id}-panel`}
            tabIndex={active ? 0 : -1}
            className={`border-b-2 px-4 py-3 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-yellow-300 ${active ? "border-yellow-400 text-yellow-300" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function CreateGrant() {
  return (
    <section id="vesting-create-panel" role="tabpanel" aria-labelledby="vesting-create-tab" className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">New grant</p>
          <h2 className="mt-2 text-xl text-zinc-100">Create vesting contract</h2>
        </div>
        <span className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Terms become fixed</span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">The recipient, token, allocation, schedule, and revocability cannot change after a grant is created.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Recipient" value="0x0a73…8412" />
        <Field label="Configured token" value="cUSDC" />
        <Field label="Allocation" value="12,000 cUSDC" />
        <Field label="Revocability" value="Revocable" />
        <Field label="Start" value="Oct 1, 2026" />
        <Field label="End" value="Oct 1, 2030" />
        <div className="sm:col-span-2"><Field label="Optional cliff" value="Oct 1, 2027" /></div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" disabled className={disabledButton}>Create grant</button>
        <p className="text-sm text-zinc-500">Grant creation is not connected yet.</p>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <label className="text-xs text-zinc-400">{label}<input value={value} readOnly aria-label={label} className={field} /></label>;
}

function GrantWorkbench({ workspace, grants, selectedGrant, onSelect }: { workspace: VestingWorkspace; grants: readonly VestingGrant[]; selectedGrant: VestingGrant; onSelect: (grantId: string) => void }) {
  return (
    <section id={workspace === "dao" ? "vesting-ongoing-panel" : undefined} role={workspace === "dao" ? "tabpanel" : undefined} aria-labelledby={workspace === "dao" ? "vesting-ongoing-tab" : undefined} className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      <GrantList workspace={workspace} grants={grants} selectedGrantId={selectedGrant.id} onSelect={onSelect} />
      <GrantDetail workspace={workspace} grant={selectedGrant} />
    </section>
  );
}

function GrantList({ workspace, grants, selectedGrantId, onSelect }: { workspace: VestingWorkspace; grants: readonly VestingGrant[]; selectedGrantId: string; onSelect: (grantId: string) => void }) {
  return (
    <section className={panel} aria-label={workspace === "dao" ? "Created by me" : "Received by me"}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{workspace === "dao" ? "Created by me" : "Received by me"}</p>
      <h2 className="mt-2 text-lg text-zinc-100">{grants.length} preview grants</h2>
      <div className="mt-5 grid gap-2">
        {grants.map((grant) => {
          const selected = grant.id === selectedGrantId;
          return (
            <button key={grant.id} type="button" aria-pressed={selected} onClick={() => onSelect(grant.id)} className={`rounded-lg border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300 ${selected ? "border-yellow-500 bg-yellow-400/10" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-zinc-300">{grant.id}</span>
                <Status grant={grant} />
              </div>
              <p className="mt-2 text-sm text-zinc-100">{grant.token}</p>
              <p className="mt-1 text-xs text-zinc-500">{shortAddress(workspace === "dao" ? grant.recipient : grant.treasury)}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GrantDetail({ workspace, grant }: { workspace: VestingWorkspace; grant: VestingGrant }) {
  const publicFacts = [
    ["Treasury", shortAddress(grant.treasury)],
    ["Recipient", shortAddress(grant.recipient)],
    ["Token", grant.token],
    ["Start", grant.start],
    ["End", grant.end],
    ["Cliff", grant.cliff ?? "None"],
    ["Revocability", grant.revocable ? "Revocable" : "Not revocable"],
  ];
  const accounting = [
    ["Allocation", grant.privateAccounting.allocation],
    ["Vested", grant.privateAccounting.vested],
    ["Available", grant.privateAccounting.available],
    ["Claimed", grant.privateAccounting.claimed],
    ["Unvested", grant.privateAccounting.unvested],
    ...(grant.privateAccounting.outstandingRefund ? [["Outstanding refund", grant.privateAccounting.outstandingRefund]] : []),
  ];

  return (
    <div className="space-y-5">
      <section className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Grant {grant.id}</p>
            <h2 className="mt-2 text-xl text-zinc-100">Public grant details</h2>
          </div>
          <Status grant={grant} />
        </div>
        {grant.status === "stopped" && <p className="mt-4 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">Vesting stopped on {grant.revokedAt}. Previously vested tokens stay claimable.</p>}
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {publicFacts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
        </dl>
      </section>

      <section className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Private accounting</p>
            <h2 className="mt-2 text-xl text-zinc-100">Preview values</h2>
          </div>
          <span className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Not decrypted</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-400">These values show the planned layout only. Live private values require an authorized wallet and contract connection.</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          {accounting.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
        </dl>
      </section>

      {workspace === "dao" ? <TreasuryAction grant={grant} /> : <ClaimAction />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 font-mono text-sm text-zinc-100">{value}</dd></div>;
}

function Status({ grant }: { grant: VestingGrant }) {
  return <span className={`text-[10px] uppercase ${grant.status === "active" ? "text-emerald-300" : "text-amber-300"}`}>{grantStatusLabel(grant.status)}</span>;
}

function ClaimAction() {
  return (
    <section className={panel}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Recipient action</p>
      <h2 className="mt-2 text-xl text-zinc-100">Claim available</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">Only the fixed recipient can claim the available amount.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled className={disabledButton}>Claim available</button><p className="text-sm text-zinc-500">Claims are not connected yet.</p></div>
    </section>
  );
}

function TreasuryAction({ grant }: { grant: VestingGrant }) {
  const buttonLabel = grant.status === "stopped" ? "Retry refund" : "Revoke grant";
  const reason = grant.status === "stopped" ? "Refund retries are not connected yet." : grant.revocable ? "Revocation is not connected yet." : "This grant cannot be revoked.";

  return (
    <section className={panel}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Treasury action</p>
      <h2 className="mt-2 text-xl text-zinc-100">{grant.status === "stopped" ? "Refund progress" : "Grant status"}</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{grant.status === "stopped" ? "Stopped vesting does not restart if a refund fails." : "Only a fixed treasury can revoke a revocable grant."}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled className={disabledButton}>{buttonLabel}</button><p className="text-sm text-zinc-500">{reason}</p></div>
    </section>
  );
}
