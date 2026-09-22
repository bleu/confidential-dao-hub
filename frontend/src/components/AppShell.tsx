import Link from "next/link";

import { ConnectButton } from "@/components/ConnectButton";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:text-yellow-300"
      >
        Skip to content
      </a>
      <header className="mb-12 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <Link
          href="/"
          aria-label="Confidential Ops Hub home"
          className="rounded py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400"
        >
          <p className="font-mono text-lg tracking-tight text-zinc-100">
            <span aria-hidden="true" className="text-yellow-400">
              ▮{" "}
            </span>
            Confidential <span className="text-yellow-400">Ops Hub</span>
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Confidential operations for DAOs · Sepolia
          </p>
        </Link>
        <ConnectButton />
      </header>
      <main id="main-content">{children}</main>
      <footer className="mt-16 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <p className="font-mono">
          PoC — not audited · powered by{" "}
          <a
            href="https://www.zama.ai"
            target="_blank"
            rel="noreferrer"
            className="text-yellow-400/80 hover:text-yellow-300"
          >
            Zama
          </a>
        </p>
      </footer>
    </div>
  );
}
