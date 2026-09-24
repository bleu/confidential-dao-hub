"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { PayrollDemoProvider } from "@/features/payroll/PayrollDemoLedger";
import { isPayrollDemoPath } from "@/lib/workspaces";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }));

  return (
    <PayrollDemoProvider>
      {isPayrollDemoPath(pathname) ? children : (
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
      )}
    </PayrollDemoProvider>
  );
}
