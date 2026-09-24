import { notFound } from "next/navigation";

import { Vesting } from "@/features/vesting/Vesting";

export default async function CommunityVestingGrantPage({
  params,
}: {
  params: Promise<{ grantId: string }>;
}) {
  const { grantId } = await params;
  if (!/^[1-9]\d*$/.test(grantId)) notFound();

  return <Vesting workspace="community" grantId={BigInt(grantId)} />;
}
