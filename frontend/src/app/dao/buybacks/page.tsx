import type { Metadata } from "next";

import { Buybacks } from "@/features/buybacks/Buybacks";

export const metadata: Metadata = {
  title: "Buyback treasury | Confidential Ops Hub",
};

export default function TreasuryBuybackPage() {
  return <Buybacks view="treasury" workspace="dao" />;
}
