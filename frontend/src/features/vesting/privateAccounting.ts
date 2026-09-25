import type { SignTypedDataFn } from "../../lib/decryption-client";

import {
  privateAmountPairs,
  type PrivateGrantAmounts,
  type PublicGrant,
} from "./data";

type PrivateReader = {
  userDecrypt: (
    pairs: ReturnType<typeof privateAmountPairs>,
    signTypedDataAsync: SignTypedDataFn,
  ) => Promise<Map<string, bigint>>;
};

export async function decryptPrivateGrantAmounts(
  grant: PublicGrant,
  contractAddress: `0x${string}`,
  decryption: PrivateReader,
  signTypedDataAsync: SignTypedDataFn,
): Promise<PrivateGrantAmounts> {
  const values = await decryption.userDecrypt(
    privateAmountPairs(grant, contractAddress),
    signTypedDataAsync,
  );

  return {
    allocation: values.get(grant.handles.allocation)!,
    claimed: values.get(grant.handles.claimed)!,
    refundEntitlement: values.get(grant.handles.refundEntitlement)!,
    refunded: values.get(grant.handles.refunded)!,
  };
}
