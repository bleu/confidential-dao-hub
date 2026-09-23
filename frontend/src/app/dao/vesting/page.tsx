import { Suspense } from "react";

import { ComingSoon } from "@/components/ComingSoon";
import { VestingPrototype } from "@/features/vesting/VestingPrototype";
import { isPrototypeVariant } from "@/features/vesting/prototype";

export default async function DaoVestingPage({ searchParams }: {
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const { variant } = await searchParams;
  if (process.env.NODE_ENV === "production" || !isPrototypeVariant(variant)) {
    return <ComingSoon title="Vesting" />;
  }

  return <Suspense fallback={null}><VestingPrototype workspace="dao" /></Suspense>;
}
