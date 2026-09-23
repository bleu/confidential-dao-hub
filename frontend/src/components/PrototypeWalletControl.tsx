"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { ConnectButton } from "@/components/ConnectButton";
import { isPrototypeVariant } from "@/features/vesting/prototype";

export function PrototypeWalletControl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const variants = searchParams.getAll("variant");
  const isVestingPrototype = process.env.NODE_ENV !== "production"
    && (pathname === "/dao/vesting" || pathname === "/community/vesting")
    && variants.length === 1
    && isPrototypeVariant(variants[0]);

  if (isVestingPrototype) {
    return <span className="rounded border border-yellow-800 bg-yellow-950/30 px-3 py-2 font-mono text-xs text-yellow-200">Mock mode - wallet disabled</span>;
  }

  return <ConnectButton />;
}
