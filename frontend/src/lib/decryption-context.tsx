"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

import {
  createDecryptionClient,
  type DecryptionScope,
} from "./decryption-client";
import { getFhevm } from "./fhevm";

const Context = createContext<ReturnType<typeof createDecryptionClient> | null>(
  null,
);

/** Pass a stable feature scope. Account, chain, or scope changes replace all private state. */
export function DecryptionProvider({
  scope,
  children,
}: {
  scope: DecryptionScope;
  children: React.ReactNode;
}) {
  const { address, chainId } = useAccount();
  const client = useMemo(
    () =>
      createDecryptionClient(
        scope,
        chainId === scope.chainId ? address : undefined,
        getFhevm,
      ),
    [scope, address, chainId],
  );
  useEffect(() => () => client.clear(), [client]);
  return <Context.Provider value={client}>{children}</Context.Provider>;
}

export function useDecryption() {
  const client = useContext(Context);
  if (!client)
    throw new Error("Encrypted values require a feature DecryptionProvider.");
  return client;
}
