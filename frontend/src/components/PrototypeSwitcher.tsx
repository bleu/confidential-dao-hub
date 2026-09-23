"use client";

import { useEffect } from "react";

export const prototypeVariants = ["A", "B", "C"] as const;
export type PrototypeVariant = (typeof prototypeVariants)[number];
const names = { A: "Workspace rail", B: "Top navigation", C: "Task directory" };

export function PrototypeSwitcher({ variant, onChange }: {
  variant: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role='slider']")) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      onChange(prototypeVariants[(prototypeVariants.indexOf(variant) + step + 3) % 3]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, onChange]);

  if (process.env.NODE_ENV === "production") return null;
  const move = (step: number) => onChange(prototypeVariants[(prototypeVariants.indexOf(variant) + step + 3) % 3]);
  return (
    <nav aria-label="Prototype variants" className="fixed bottom-5 left-1/2 z-50 flex w-max max-w-[95vw] -translate-x-1/2 items-center gap-3 rounded-full border border-yellow-300 bg-yellow-300 px-3 py-2 text-zinc-950 shadow-xl">
      <button aria-label="Previous variant" onClick={() => move(-1)} className="rounded-full px-3 py-2 hover:bg-black/10">&lt;</button>
      <div className="text-center"><p className="text-[10px] uppercase tracking-widest">Layout prototype</p><p className="text-sm font-semibold">{variant} / {names[variant]}</p></div>
      <button aria-label="Next variant" onClick={() => move(1)} className="rounded-full px-3 py-2 hover:bg-black/10">&gt;</button>
    </nav>
  );
}
