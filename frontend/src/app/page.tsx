import Link from "next/link";

import { routes } from "@/lib/workspaces";

export default function Home() {
  return (
    <div>
      <h1 className="mb-7 text-3xl font-medium tracking-tight text-zinc-100">
        Where would you like to go?
      </h1>
      <div className="grid gap-4">
        {[
          { href: routes.community, title: "Community", text: "Explore community operations.", action: "Open workspace" },
          { href: routes.dao, title: "DAO dashboard", text: "Manage DAO operations.", action: "Open workspace" },
        ].map(({ href, title, text, action }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-yellow-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400"
          >
            <h2 className="text-xl text-zinc-100">{title}</h2>
            <p className="mt-3 text-sm text-zinc-400">{text}</p>
            <p className="mt-6 text-sm text-yellow-300">{action} <span aria-hidden="true">&gt;</span></p>
          </Link>
        ))}
      </div>
    </div>
  );
}
