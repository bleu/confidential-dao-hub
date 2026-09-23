import type { Metadata } from "next";

import { Buybacks } from "@/features/buybacks/Buybacks";

export const metadata: Metadata = {
  title: "Sell cTOKEN | Confidential Ops Hub",
};

export default function SellBuybackPage() {
  return <Buybacks view="sell" workspace="community" />;
}
