import type { Metadata } from "next";

import { Buybacks } from "@/features/buybacks/Buybacks";
import { reportWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = {
  title: "Public buyback report | Confidential Ops Hub",
};

export default async function BuybackReportPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string | string[] }>;
}) {
  const { workspace } = await searchParams;
  return <Buybacks view="report" workspace={reportWorkspace(workspace)} />;
}
