"use client";

import { useState } from "react";

import { ConnectButton } from "@/components/ConnectButton";
import { SellPanel } from "@/components/SellPanel";
import { TransparencyPanel } from "@/components/TransparencyPanel";
import { TreasuryPanel } from "@/components/TreasuryPanel";
import { CONTRACTS } from "@/config/contracts";

const TABS = ["sell", "treasury", "transparency"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [tab, setTab] = useState<Tab>("sell");

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg tracking-tight text-zinc-100">
            <span className="text-yellow-400">▮</span> confidential<span className="text-yellow-400">buybacks</span>
          </h1>
          <p className="mt-1 text-xs text-zinc-600">
            dark-pool buybacks on Zama FHEVM · Sepolia · budgets, offers &amp; fills encrypted on-chain
          </p>
        </div>
        <ConnectButton />
      </header>

      <nav className="mb-8 flex gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 font-mono text-sm transition-colors ${
              tab === t ? "border-b-2 border-yellow-400 text-yellow-300" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === "sell" && <SellPanel />}
        {tab === "treasury" && <TreasuryPanel />}
        {tab === "transparency" && <TransparencyPanel />}
      </main>

      <footer className="mt-16 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        <p>
          Hidden on-chain: budget · remaining · offers · fills · payouts. Public: reference price, participation
          metadata, and epoch totals after delayed disclosure.
        </p>
        <p className="mt-1 font-mono">
          vault {CONTRACTS.vault.slice(0, 10)}… · cTOKEN {CONTRACTS.cToken.slice(0, 10)}… · PoC — not audited ·{" "}
          <a
            href="https://www.zama.ai"
            target="_blank"
            rel="noreferrer"
            className="text-yellow-400/80 transition-colors hover:text-yellow-300"
          >
            powered by Zama
          </a>
        </p>
      </footer>
    </div>
  );
}
