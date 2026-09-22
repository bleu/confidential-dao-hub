import Link from "next/link";

const upcomingFeatures = [
  {
    name: "Payroll",
    description: "Confidential employee payments from your DAO treasury.",
  },
  {
    name: "Payment Requests",
    description: "Invoices, contractor payments, and expense reimbursements.",
  },
  {
    name: "Token Launchpad",
    description: "Token launches for the next stage of your DAO.",
  },
  {
    name: "Vesting",
    description:
      "Scheduled token distributions for contributors and stakeholders.",
  },
  {
    name: "Governance",
    description: "Confidential participation in DAO decision-making.",
  },
  {
    name: "Airdrop / Staking",
    description: "Token distribution and participation incentives.",
  },
];

export default function Home() {
  return (
    <div>
      <div className="mb-8 max-w-xl">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-yellow-400">
          DAO operations
        </p>
        <h1 className="text-balance text-3xl font-medium tracking-tight text-zinc-100 sm:text-4xl">
          Your treasury. Your operations. Confidential.
        </h1>
        <p className="mt-4 text-pretty text-sm leading-6 text-zinc-400">
          A workspace for DAO treasury teams. Start with buybacks; more
          confidential operations are on the way.
        </p>
      </div>
      <section aria-label="Operations" className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/buybacks"
          className="group rounded-lg border border-yellow-700/60 bg-yellow-950/15 p-5 transition-colors hover:border-yellow-500 hover:bg-yellow-950/30 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-mono text-lg text-zinc-100">Buybacks</h2>
            <span className="rounded border border-yellow-800 px-2 py-1 font-mono text-xs text-yellow-300">
              Available
            </span>
          </div>
          <p className="text-pretty text-sm leading-6 text-zinc-400">
            Buy back your DAO’s token with encrypted budgets, offers, and seller
            price floors.
          </p>
          <p className="mt-6 font-mono text-sm text-yellow-300">
            Open buybacks <span aria-hidden="true">→</span>
          </p>
        </Link>
        {upcomingFeatures.map(({ name, description }) => (
          <article
            key={name}
            className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-mono text-lg text-zinc-200">{name}</h2>
              <span className="rounded border border-zinc-700 px-2 py-1 font-mono text-xs text-zinc-400">
                Soon
              </span>
            </div>
            <p className="text-pretty text-sm leading-6 text-zinc-400">
              {description}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
