import type { Metadata } from "next";
import Link from "next/link";

import { CURRENT_DAO, workspaceLinks } from "@/lib/workspaces";

export const metadata: Metadata = {
  title: "DAO dashboard | Confidential Ops Hub",
};

export default function DaoPage() {
  return (
    <div>
      <h1 className="mb-7 text-3xl font-medium tracking-tight text-zinc-100">{CURRENT_DAO.name}</h1>
      <div className="divide-y divide-zinc-800 border-y border-zinc-800">
        {workspaceLinks("dao").filter(({ label }) => label !== "Overview").map(({ href, label, soon }) => (
          <Link key={href} href={href} className="flex items-center justify-between gap-4 rounded py-6 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400">
            <div>
              <h2 className="text-lg">{label}</h2>
              {!soon && <p className="mt-1 text-xs text-zinc-500">cTOKEN / Treasury tools and reports</p>}
            </div>
            <span className={`text-xs ${soon ? "text-zinc-500" : "text-yellow-300"}`}>{soon ? "Soon" : "Open >"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
