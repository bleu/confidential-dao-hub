"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  CURRENT_DAO,
  isWorkspaceLinkActive,
  routes,
  workspaceForPath,
  workspaceLinks,
} from "@/lib/workspaces";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400";

export function WorkspaceNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const origins = searchParams.getAll("workspace");
  const workspace = workspaceForPath(pathname, origins.length === 1 ? origins[0] : undefined);

  return (
    <aside className="border-b border-zinc-800 bg-zinc-900/40 p-4 md:border-r md:border-b-0">
      <Link href={routes.home} className={`mb-5 inline-flex min-h-11 items-center rounded font-mono text-xs text-zinc-400 hover:text-yellow-300 ${focus}`}>
        Choose workspace
      </Link>
      <nav aria-label="Workspaces" className="grid grid-cols-2 gap-2 md:grid-cols-1">
        {([
          { id: "community", href: routes.community, label: "Community" },
          { id: "dao", href: routes.dao, label: "DAO dashboard" },
        ] as const).map(({ id, href, label }) => (
          <Link
            key={id}
            href={href}
            aria-current={workspace === id ? "true" : undefined}
            className={`rounded-md px-3 py-3 text-sm ${focus} ${workspace === id ? "bg-yellow-300 text-zinc-950" : "bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {workspace && (
        <>
          <p className="mt-6 mb-2 text-[10px] uppercase tracking-widest text-zinc-500">
            {workspace === "dao" ? CURRENT_DAO.name : "Your activity"}
          </p>
          <nav aria-label="Features" className="flex flex-wrap gap-1 md:grid">
            {workspaceLinks(workspace).map(({ href, label, soon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isWorkspaceLinkActive(pathname, href) ? "page" : undefined}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${focus} ${isWorkspaceLinkActive(pathname, href) ? "bg-yellow-400/10 text-yellow-300" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}
              >
                <span>{label}</span>
                {soon && <span className="text-[10px] uppercase text-zinc-500">Soon</span>}
              </Link>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
