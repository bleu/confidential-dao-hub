"use client";

// Throwaway: three workspace layouts on /?variant=A, B, or C. All values and actions are simulated.
import { useCallback, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PrototypeSwitcher, type PrototypeVariant } from "@/components/PrototypeSwitcher";

type Area = "start" | "community" | "dao";
type Page = "overview" | "buybacks" | "detail" | "report" | "vesting" | "payroll";
type Wallet = "visitor" | "holder" | "treasury";
type LayoutProps = {
  area: Area;
  page: Page;
  go: (area: Area, page?: Page) => void;
  children: ReactNode;
};

const button = "rounded-md border border-zinc-700 px-4 py-2 text-sm transition hover:border-yellow-400 hover:text-yellow-300 focus-visible:outline-2 focus-visible:outline-yellow-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500";
const primary = `${button} border-yellow-400 bg-yellow-300 text-zinc-950 hover:bg-yellow-200 hover:text-zinc-950 disabled:bg-zinc-900`;
const panel = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";
const labels: Record<Page, string> = { overview: "Overview", buybacks: "Buybacks", detail: "cTOKEN buyback", report: "Public report", vesting: "Vesting", payroll: "Payroll" };

function AreaButtons({ area, go }: Pick<LayoutProps, "area" | "go">) {
  return <div className="flex flex-wrap gap-2">{(["community", "dao"] as const).map(item => <button key={item} onClick={() => go(item)} aria-pressed={area === item} className={`${button} ${area === item ? "border-yellow-400 bg-yellow-400/10 text-yellow-300" : ""}`}>{item === "community" ? "Community" : "DAO dashboard"}</button>)}</div>;
}

function FeatureLinks({ area, page, go, vertical = false }: Omit<LayoutProps, "children"> & { vertical?: boolean }) {
  const pages: Page[] = area === "dao" ? ["overview", "buybacks", "vesting", "payroll"] : ["buybacks", "vesting", "payroll"];
  return <nav aria-label="Features" className={vertical ? "grid gap-2" : "flex flex-wrap gap-2"}>{pages.map(item => {
    const active = page === item || (item === "buybacks" && (page === "detail" || page === "report"));
    const soon = item === "vesting" || item === "payroll";
    return <button key={item} onClick={() => go(area, item)} aria-current={active ? "page" : undefined} className={`flex items-center justify-between gap-3 rounded-md px-3 py-3 text-left text-sm ${active ? "bg-yellow-400/10 text-yellow-300" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}><span>{area === "community" && soon ? `My ${item}` : labels[item]}</span>{soon && <span className="text-[10px] uppercase text-zinc-500">Soon</span>}</button>;
  })}</nav>;
}

export function VariantA({ area, page, go, children }: LayoutProps) {
  return <div className="grid overflow-hidden rounded-xl border border-zinc-800 md:grid-cols-[185px_1fr]">
    <aside className="border-b border-zinc-800 bg-zinc-900/50 p-4 md:border-r md:border-b-0">
      <button onClick={() => go("start")} className="mb-7 font-mono text-xs text-zinc-400 hover:text-yellow-300">/ Choose workspace</button>
      <div className="grid gap-2">{(["community", "dao"] as const).map(item => <button key={item} onClick={() => go(item)} className={`rounded-md px-3 py-3 text-left text-sm ${area === item ? "bg-yellow-300 text-zinc-950" : "bg-zinc-800/60 text-zinc-300"}`}>{item === "community" ? "Community" : "DAO dashboard"}</button>)}</div>
      {area !== "start" && <><p className="mt-8 mb-3 text-[10px] uppercase tracking-widest text-zinc-500">{area === "dao" ? "Demo DAO" : "Your activity"}</p><FeatureLinks area={area} page={page} go={go} vertical /></>}
    </aside>
    <div className="min-w-0 p-5 sm:p-7">{children}</div>
  </div>;
}

export function VariantB({ area, page, go, children }: LayoutProps) {
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-700 pb-5"><button onClick={() => go("start")} className="font-mono text-sm text-zinc-400 hover:text-yellow-300">Choose workspace</button><AreaButtons area={area} go={go} /></div>
    {area !== "start" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 py-3"><FeatureLinks area={area} page={page} go={go} /><span className="text-xs text-zinc-500">{area === "dao" ? "Demo DAO / Sepolia" : "Connected wallet activity"}</span></div>}
    <div className="py-8">{children}</div>
  </div>;
}

export function VariantC({ area, page, go, children }: LayoutProps) {
  return <div>
    <div className="mb-8 flex flex-wrap items-center gap-3 font-mono text-xs text-zinc-400"><button onClick={() => go("start")} className="hover:text-yellow-300">Workspaces</button>{area !== "start" && <><span>/</span><button onClick={() => go(area)} className="hover:text-yellow-300">{area === "community" ? "Community" : "Demo DAO"}</button><span>/</span><span className="text-zinc-100">{labels[page]}</span></>}</div>
    <div className="grid gap-8 md:grid-cols-[1fr_190px]"><div className="min-w-0">{children}</div><aside className="border-t border-zinc-800 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-5"><p className="mb-4 text-[10px] uppercase tracking-widest text-zinc-500">Go to workspace</p><div className="grid gap-2"><button className={`${button} text-left`} onClick={() => go("community")}>Community</button><button className={`${button} text-left`} onClick={() => go("dao")}>DAO dashboard</button></div>{area !== "start" && <div className="mt-8"><FeatureLinks area={area} page={page} go={go} vertical /></div>}</aside></div>
  </div>;
}

export default function WorkspacePrototype() {
  const router = useRouter();
  const search = useSearchParams();
  const rawVariant = search.get("variant");
  const variant: PrototypeVariant = rawVariant === "B" || rawVariant === "C" ? rawVariant : "A";
  const [area, setArea] = useState<Area>("start");
  const [page, setPage] = useState<Page>("overview");
  const [wallet, setWallet] = useState<Wallet>("visitor");
  const [decrypted, setDecrypted] = useState(false);
  const [notice, setNotice] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [floor, setFloor] = useState("1.80");
  const go = (next: Area, target?: Page) => {
    setArea(next);
    setPage(target ?? (next === "community" ? "buybacks" : "overview"));
    setDecrypted(false);
    setNotice("");
  };
  const changeVariant = useCallback((next: PrototypeVariant) => {
    const params = new URLSearchParams(search.toString());
    params.set("variant", next);
    router.replace(`/?${params}`, { scroll: false });
  }, [router, search]);
  const Layout = variant === "B" ? VariantB : variant === "C" ? VariantC : VariantA;
  const isTreasury = wallet === "treasury";
  const canRead = area === "dao" ? isTreasury : wallet !== "visitor";
  const restricted = wallet === "visitor" ? "Connect a wallet to sell or claim." : "";
  const reportLink = <button className="text-sm text-yellow-300 underline decoration-yellow-700 underline-offset-4" onClick={() => go(area, "report")}>View public buyback report</button>;
  const compact = variant === "A";
  const intro = (eyebrow: string, title: string, text: string) => <div className="mb-7">{!compact && <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-yellow-300">{eyebrow}</p>}<h1 className="text-3xl font-medium tracking-tight text-zinc-100">{title}</h1>{!compact && <p className="mt-3 text-sm leading-6 text-zinc-400">{text}</p>}</div>;
  const privateValue = (label: string, value: string) => <div className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-700 p-4"><div><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 font-mono text-lg text-zinc-100">{decrypted && canRead ? value : "Encrypted"}</p></div>{canRead && !decrypted && <button className={button} onClick={() => { setDecrypted(true); setNotice("Demo signature accepted. These are sample values, not wallet data."); }}>Decrypt (demo)</button>}</div>;

  let content: ReactNode;
  if (area === "start") {
    const choices = [{ area: "community" as const, number: "01", title: "Community", text: compact ? "Buybacks and your payments." : "Find a buyback. Sell your tokens. Follow what is owed to your wallet.", action: "Explore buybacks" }, { area: "dao" as const, number: "02", title: "DAO dashboard", text: compact ? "Treasury tools and reports." : "Inspect your DAO's operations. Use treasury tools with an authorized wallet.", action: "View Demo DAO" }];
    content = <>{intro("Confidential Ops Hub", "Where would you like to go?", "Both areas are open to everyone. Your wallet controls which private amounts and actions are available.")}
      <div className={variant === "B" ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>{choices.map(choice => <button key={choice.area} onClick={() => go(choice.area)} className={variant === "C" ? "group flex items-start gap-5 border-t border-zinc-700 py-6 text-left" : `${panel} group text-left transition hover:border-yellow-500`}><span className="font-mono text-xs text-yellow-400">{choice.number}</span><div><h2 className="mt-3 text-xl text-zinc-100">{choice.title}</h2><p className="mt-3 text-sm leading-6 text-zinc-400">{choice.text}</p><p className="mt-6 text-sm text-yellow-300">{choice.action} &gt;</p></div></button>)}</div>{!compact && <p className="mt-5 text-xs text-zinc-500">One DAO on Sepolia. No wallet needed to browse.</p>}</>;
  } else if (page === "report") {
    content = <>{intro("Demo DAO / Buybacks", "Public buyback report", "The same report is available to community members and treasury teams.")}<div className={panel}><h2 className="text-lg text-zinc-100">Epoch 12</h2><p className="mt-2 text-sm text-zinc-400">Sample closed epoch. Aggregate totals have not been disclosed.</p><dl className="mt-5 divide-y divide-zinc-800 text-sm">{["Total sold", "Total paid"].map(label => <div key={label} className="flex flex-wrap justify-between gap-2 py-4"><dt className="text-zinc-400">{label}</dt><dd>Not disclosed</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-zinc-500">{compact ? "Offers and price floors stay private." : "Only eligible aggregate totals can become public. Individual offers and price floors stay private. This prototype does not request disclosure."}</p></div><button className={`${button} mt-5`} onClick={() => go(area, area === "dao" ? "buybacks" : "detail")}>Back to buyback</button></>;
  } else if (page === "vesting" || page === "payroll") {
    content = <>{intro(area === "community" ? "Community / Your wallet" : "Demo DAO / Operations", area === "community" ? `My ${page}` : labels[page], area === "community" ? (page === "vesting" ? "Your grants will appear here, including grants from different DAOs." : "Payments to your wallet will appear here, including payments from different DAOs.") : (page === "vesting" ? "Create and manage grants from this DAO." : "Send confidential payments from this DAO."))}<div className={`${panel} py-12 text-center`}><span className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Soon</span>{!compact && <><p className="mt-5 text-sm text-zinc-400">This feature has no app page yet.</p><p className="mt-2 text-xs text-zinc-500">No wallet data is loaded in this preview.</p></>}</div></>;
  } else if (area === "dao" && page === "overview") {
    content = <>{intro("DAO dashboard / Sepolia", "Demo DAO", "View public operations here. Connect the treasury wallet to manage buybacks.")}{!compact && <p className="mb-6 text-xs text-zinc-500">Demo DAO is a prototype name for the current cTOKEN deployment.</p>}<div className="divide-y divide-zinc-800 border-y border-zinc-800">{(["buybacks", "vesting", "payroll"] as const).map(item => <button key={item} onClick={() => go("dao", item)} className="flex w-full items-center justify-between gap-4 py-6 text-left hover:text-yellow-300"><div><h2 className="text-lg">{labels[item]}</h2><p className="mt-1 text-xs text-zinc-500">{item === "buybacks" ? "cTOKEN / Treasury tools and public reports" : "Confidential treasury operations"}</p></div><span className="text-xs text-yellow-300">{item === "buybacks" ? "Open >" : "Soon"}</span></button>)}</div></>;
  } else if (area === "community" && page === "buybacks") {
    content = <>{intro("Community / Buybacks", "Find a buyback", "Choose a token to sell back to its DAO. Each buyback contains its own settlement epochs.")}<div className={variant === "C" ? "border-y border-zinc-700 py-6" : panel}><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-mono text-xs text-zinc-400">Demo DAO / Sepolia</span><span className="rounded border border-yellow-800 px-2 py-1 text-xs text-yellow-300">Sample open epoch</span></div><h2 className="mt-5 text-2xl text-zinc-100">cTOKEN buyback</h2><p className="mt-2 text-sm text-zinc-400">Sell cTOKEN for cUSDT with a private price floor.</p><div className="mt-6 flex flex-wrap items-center gap-4"><button className={primary} onClick={() => go("community", "detail")}>Open buyback</button>{reportLink}</div></div>{!compact && <p className="mt-5 text-xs text-zinc-500">Showing the one configured buyback. More DAOs can be listed here later.</p>}</>;
  } else if (area === "community") {
    content = <>{intro("Community / Demo DAO", "Sell cTOKEN", "Sample epoch 13. Set the minimum price you accept. Your offer amounts stay private.")}<div className={panel}><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-zinc-400">Amount (cTOKEN)<input value={quantity} onChange={event => setQuantity(event.target.value)} type="number" min="0" className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 text-base text-zinc-100" /></label><label className="text-xs text-zinc-400">Price floor (cUSDT per token)<input value={floor} onChange={event => setFloor(event.target.value)} type="number" min="0" step="0.01" className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 text-base text-zinc-100" /></label></div><button disabled={wallet === "visitor" || Number(quantity) <= 0 || Number(floor) <= 0} className={`${primary} mt-5`} onClick={() => setNotice(`Demo offer: ${quantity} cTOKEN at a ${floor} cUSDT minimum. Nothing was sent.`)}>Preview offer</button>{restricted && <p className="mt-3 text-xs text-zinc-500">{restricted}</p>}</div><div className={`${panel} mt-4`}><h2 className="text-lg text-zinc-100">Your previous epoch</h2>{privateValue("Claimable proceeds / sample epoch 12", "180 cUSDT")}<button disabled={wallet === "visitor" || !decrypted} className={button} onClick={() => setNotice("Demo claim preview. No funds moved.")}>Preview claim</button>{wallet !== "visitor" && !decrypted && <p className="mt-3 text-xs text-zinc-500">Decrypt the sample amount to preview a claim.</p>}</div><div className="mt-5">{reportLink}</div></>;
  } else {
    content = <>{intro("DAO dashboard / Demo DAO", "Buyback treasury", "Manage the cTOKEN buyback. Anyone can inspect this page; treasury actions need the authorized wallet.")}<div className={panel}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg text-zinc-100">Sample epoch 13</h2><span className="text-xs text-yellow-300">Open</span></div>{privateValue("Remaining confidential budget", "8,200 cUSDT")}<div className="flex flex-wrap gap-3">{["Top up epoch", "Change duration", "Roll epoch early"].map(action => <button key={action} disabled={!isTreasury} className={button} onClick={() => setNotice(`Demo: ${action}. No contract call was made.`)}>{action}</button>)}</div>{!isTreasury && <p className="mt-4 text-xs text-zinc-500">Connect the treasury wallet to use these controls or decrypt the budget.</p>}<p className="mt-4 text-xs leading-5 text-zinc-500">This sample epoch has not expired. After expiry, anyone can roll it.</p></div><div className="mt-5">{reportLink}</div></>;
  }

  return <div className="pb-24">
    <div className="mb-6 rounded-lg border border-dashed border-yellow-800 bg-yellow-950/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-xs text-yellow-300">THROWAWAY UI PROTOTYPE</p><p className="mt-1 text-xs text-zinc-400">{compact ? "Demo only. No transactions. Wallet below is simulated." : "Sample data. No signatures or transactions. The header wallet is not used."}</p></div><label className="text-xs text-zinc-400">Simulate wallet<select aria-label="Simulate wallet" value={wallet} onChange={event => { setWallet(event.target.value as Wallet); setDecrypted(false); setNotice(""); }} className="ml-2 rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-100"><option value="visitor">Disconnected</option><option value="holder">Community wallet</option><option value="treasury">Treasury wallet</option></select></label></div></div>
    <Layout area={area} page={page} go={go}>{content}{notice && <p role="status" className="mt-5 rounded-md border border-yellow-800 bg-yellow-950/20 p-4 text-sm text-yellow-200">{notice}</p>}</Layout>
    <details className="mt-6 rounded border border-zinc-800 p-3 text-xs text-zinc-500"><summary className="cursor-pointer">Prototype state / {variant} / {area} / {page} / {wallet}</summary><pre className="mt-3 overflow-auto">{JSON.stringify({ variant, area, page, wallet, decrypted, quantity, floor, notice, dao: "Demo DAO", data: "simulated", transactions: false }, null, 2)}</pre></details>
    <PrototypeSwitcher variant={variant} onChange={changeVariant} />
  </div>;
}
