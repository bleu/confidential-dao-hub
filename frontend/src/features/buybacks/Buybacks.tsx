"use client";

import Link from "next/link";

import { SellPanel } from "./components/SellPanel";
import { TreasuryPanel } from "./components/TreasuryPanel";
import { TransparencyPanel } from "./components/TransparencyPanel";
import { BUYBACK_DECRYPTION_SCOPE } from "./contracts";
import { DecryptionProvider } from "@/lib/decryption-context";
import { buybackHref, reportHref, routes, type Workspace } from "@/lib/workspaces";

type View = "sell" | "treasury" | "report";

export function Buybacks({ view, workspace }: { view: View; workspace: Workspace }) {
  const title = view === "sell" ? "Sell cTOKEN" : view === "treasury" ? "Buyback treasury" : "Public buyback report";

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-medium tracking-tight text-zinc-100">{title}</h1>
        <Link
          href={view === "report" ? buybackHref(workspace) : reportHref(workspace)}
          className="inline-flex min-h-11 items-center rounded text-sm text-yellow-300 underline decoration-yellow-800 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400"
        >
          {view === "report" ? "Back to buyback" : "Public report"}
        </Link>
      </div>
      {view === "report" ? (
        <TransparencyPanel />
      ) : (
        <DecryptionProvider key={view} scope={BUYBACK_DECRYPTION_SCOPE}>
          {view === "sell" ? <SellPanel /> : <TreasuryPanel />}
        </DecryptionProvider>
      )}
      {view === "sell" && (
        <Link href={routes.community} className="mt-6 inline-flex min-h-11 items-center rounded text-sm text-zinc-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-yellow-400">
          All buybacks
        </Link>
      )}
    </div>
  );
}
