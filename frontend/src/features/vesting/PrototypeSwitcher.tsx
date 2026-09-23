"use client";

import { useEffect } from "react";

import { prototypeVariants, type PrototypeVariant, variantName } from "./prototype";

export function PrototypeSwitcher({ variant, onChange }: {
  variant: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role='slider']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      const current = prototypeVariants.indexOf(variant);
      const step = event.key === "ArrowLeft" ? -1 : 1;
      onChange(prototypeVariants[(current + step + prototypeVariants.length) % prototypeVariants.length]);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange, variant]);

  if (process.env.NODE_ENV === "production") return null;

  function move(step: number) {
    const current = prototypeVariants.indexOf(variant);
    onChange(prototypeVariants[(current + step + prototypeVariants.length) % prototypeVariants.length]);
  }

  return (
    <nav aria-label="Prototype variants" className="fixed bottom-5 left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 items-center gap-3 rounded-full border border-yellow-300 bg-yellow-300 px-3 py-2 text-zinc-950 shadow-xl">
      <button aria-label="Previous variant" onClick={() => move(-1)} className="rounded-full px-3 py-2 hover:bg-black/10">
        &lt;
      </button>
      <div className="min-w-36 text-center">
        <p className="text-[10px] uppercase tracking-widest">Vesting prototype</p>
        <p className="text-sm font-semibold">{variant} / {variantName(variant)}</p>
      </div>
      <button aria-label="Next variant" onClick={() => move(1)} className="rounded-full px-3 py-2 hover:bg-black/10">
        &gt;
      </button>
    </nav>
  );
}
