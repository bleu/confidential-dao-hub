import type { Metadata } from "next";

import { Buybacks } from "@/features/buybacks/Buybacks";

export const metadata: Metadata = {
  title: "Buybacks | Confidential Ops Hub",
  description:
    "Confidential DAO token buybacks with encrypted budgets, offers, and seller price floors.",
};

export default function BuybacksPage() {
  return <Buybacks />;
}
