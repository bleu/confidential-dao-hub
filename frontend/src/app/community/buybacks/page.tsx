import Link from "next/link";

import { CONTRACTS } from "@/features/buybacks/contracts";
import { CURRENT_DAO, reportHref, routes } from "@/lib/workspaces";

export default function CommunityBuybacks() {
  return (
    <div>
      <h1 className="mb-7 text-3xl font-medium tracking-tight text-zinc-100">Find a buyback</h1>
      <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
        <p className="font-mono text-xs text-zinc-400">{CURRENT_DAO.name} / {CURRENT_DAO.network}</p>
        <h2 className="mt-5 text-2xl text-zinc-100">cTOKEN buyback</h2>
        <p className="mt-2 text-sm text-zinc-400">Sell cTOKEN for cUSDT.</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href={routes.sell} className="inline-flex min-h-11 items-center rounded-md bg-yellow-300 px-4 py-2 text-sm text-zinc-950 hover:bg-yellow-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400">
            Open buyback
          </Link>
          <Link href={reportHref("community")} className="inline-flex min-h-11 items-center rounded text-sm text-yellow-300 underline decoration-yellow-800 underline-offset-4 focus-visible:outline-2 focus-visible:outline-yellow-400">
            Public report
          </Link>
          <a href={`https://sepolia.etherscan.io/address/${CONTRACTS.vault}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded text-xs text-zinc-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-yellow-400">
            View contract
          </a>
        </div>
      </article>
    </div>
  );
}
