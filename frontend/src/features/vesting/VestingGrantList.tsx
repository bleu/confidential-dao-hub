import type { PublicGrant } from "./data";
import type { VestingDiscoveryState } from "./useGrants";

const panel = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";

type VestingWorkspace = "community" | "dao";

export function VestingGrantList({
  workspace,
  state,
  grants,
  hrefFor,
}: {
  workspace: VestingWorkspace;
  state: VestingDiscoveryState;
  grants: readonly PublicGrant[];
  hrefFor: (grantId: bigint) => string;
}) {
  const label = workspace === "dao" ? "Created by me" : "Received by me";
  const message = discoveryMessage(state, label);

  return (
    <section className={panel} aria-label={label}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
      <h2 className="mt-2 text-lg text-zinc-100">Vesting grant records</h2>
      {message ? (
        <p className="mt-5 text-sm text-zinc-400" role={state === "error" ? "alert" : undefined}>{message}</p>
      ) : (
        <div className="mt-5 grid gap-2">
          {grants.map((grant) => (
            <a
              key={grant.id}
              href={hrefFor(grant.id)}
              aria-label={`Grant ${grant.id}`}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-left transition hover:border-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300"
            >
              <span className="font-mono text-xs text-zinc-300">Grant {grant.id}</span>
              <p className="mt-2 break-all font-mono text-xs text-zinc-400">{grant.token}</p>
              <p className="mt-1 text-xs text-zinc-500">{workspace === "dao" ? grant.recipient : grant.treasury}</p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function discoveryMessage(state: VestingDiscoveryState, label: string): string | null {
  if (state === "disconnected") return "Connect a wallet to find grants.";
  if (state === "wrong-network") return "Switch to Sepolia to find grants.";
  if (state === "loading") return "Loading grants…";
  if (state === "error") return "Could not read grants. Try again.";
  if (state === "empty") return `No ${label.toLowerCase()} grants were found.`;
  return null;
}
