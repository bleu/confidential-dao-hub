export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="mb-7 text-3xl font-medium tracking-tight text-zinc-100">{title}</h1>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-12 text-center">
        <span className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Soon</span>
      </div>
    </div>
  );
}
