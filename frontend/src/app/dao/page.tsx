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
        {workspaceLinks("dao").filter(({ label }) => label !== "Overview").map(({ href, label, soon }) => soon ? (
          <div key={href} aria-disabled="true" className="flex items-center justify-between gap-4 py-6 text-zinc-500">
            <h2 className="text-lg">{label}</h2>
            <span className="text-xs">Soon</span>
          </div>
        ) : (
          <Link key={href} href={href} className="flex items-center justify-between gap-4 rounded py-6 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400">
            <div>
              <h2 className="text-lg">{label}</h2>
              <p className="mt-1 text-xs text-zinc-500">{label === "Payroll" ? "Mock sender flow with private payment details" : "cTOKEN / Create and manage buybacks"}</p>
            </div>
            <span className="text-xs text-yellow-300">{label === "Payroll" ? "Open payroll" : "Manage buyback"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
