"use client";

import Link from "next/link";
import { useState } from "react";

import { SellPanel } from "./components/SellPanel";
import { TreasuryPanel } from "./components/TreasuryPanel";
import { TransparencyPanel } from "./components/TransparencyPanel";
import { BUYBACK_DECRYPTION_SCOPE } from "./contracts";
import { DecryptionProvider } from "@/lib/decryption-context";

const tabs = ["sell", "treasury", "transparency"] as const;

export function Buybacks() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("sell");

  return (
    <DecryptionProvider scope={BUYBACK_DECRYPTION_SCOPE}>
      <Link
        href="/"
        className="mb-4 inline-flex min-h-11 items-center font-mono text-sm text-zinc-400 hover:text-yellow-300"
      >
        ← All operations
      </Link>
      <h1 className="font-mono text-2xl text-zinc-100">Buybacks</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Rolling settlement windows with encrypted budgets, offers, and price
        floors.
      </p>
      <nav
        aria-label="Buyback views"
        className="my-8 flex gap-1 overflow-x-auto border-b border-zinc-800"
      >
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
            className={`min-h-11 px-4 py-2 font-mono text-sm capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-yellow-400 ${tab === item ? "border-b-2 border-yellow-400 text-yellow-300" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {item}
          </button>
        ))}
      </nav>
      {tab === "sell" && <SellPanel />}
      {tab === "treasury" && <TreasuryPanel />}
      {tab === "transparency" && <TransparencyPanel />}
    </DecryptionProvider>
  );
}
