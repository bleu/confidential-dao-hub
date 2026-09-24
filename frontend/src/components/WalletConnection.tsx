"use client";

import { usePathname } from "next/navigation";

import { isPayrollDemoPath } from "@/lib/workspaces";

import { ConnectButton } from "@/components/ConnectButton";

export function WalletConnection() {
  const pathname = usePathname();
  if (isPayrollDemoPath(pathname)) return null;
  return <ConnectButton />;
}
