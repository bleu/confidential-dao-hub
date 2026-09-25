import type { FhevmInstance } from "./fhevm";

export type SignTypedDataFn = (args: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<`0x${string}`>;

export type DecryptionScope = {
  chainId: number;
  contractAddresses: readonly string[];
};

type Pair = { handle: string; contractAddress: string };
type Session = {
  keypair: { publicKey: string; privateKey: string };
  signature: string;
  startTimestamp: number;
  durationDays: number;
};
type SDK = Pick<
  FhevmInstance,
  "generateKeypair" | "createEIP712" | "userDecrypt"
>;

const ZERO_HANDLE = `0x${"0".repeat(64)}`;

/** One immutable wallet/chain/contract scope owns all private session state. */
export function createDecryptionClient(
  scope: DecryptionScope,
  userAddress: string | undefined,
  loadSDK: () => Promise<SDK>,
) {
  const contracts = [
    ...new Set(scope.contractAddresses.map((a) => a.toLowerCase())),
  ].sort();
  const cache = new Map<string, bigint>();
  const listeners = new Set<() => void>();
  let session: Promise<Session> | undefined;
  let expiresAt = 0;
  let generation = 0;
  let version = 0;

  const key = ({ handle, contractAddress }: Pair) =>
    `${contractAddress.toLowerCase()}:${handle.toLowerCase()}`;
  const contains = (contractAddress: string) =>
    contracts.includes(contractAddress.toLowerCase());
  const notify = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  const assertCurrent = (started: number) => {
    if (generation !== started)
      throw new Error("Decryption session changed. Please retry.");
  };

  const getCachedDecryption = (
    handle: string,
    contractAddress: string,
  ): bigint | undefined => {
    if (!userAddress || !contains(contractAddress)) return undefined;
    return cache.get(key({ handle, contractAddress }));
  };

  async function getSession(sign: SignTypedDataFn): Promise<Session> {
    if (session && Date.now() / 1000 < expiresAt) return session;
    const started = generation;
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 7;
    expiresAt = startTimestamp + durationDays * 86400;
    const pending = (async () => {
      const sdk = await loadSDK();
      assertCurrent(started);
      const keypair = sdk.generateKeypair();
      const eip712 = sdk.createEIP712(
        keypair.publicKey,
        contracts,
        startTimestamp,
        durationDays,
      );
      const signature = await sign({
        domain: eip712.domain as unknown as Record<string, unknown>,
        types: {
          UserDecryptRequestVerification:
            eip712.types.UserDecryptRequestVerification,
        } as Record<string, unknown>,
        primaryType: "UserDecryptRequestVerification",
        message: eip712.message as unknown as Record<string, unknown>,
      });
      assertCurrent(started);
      return {
        keypair,
        signature: signature.replace(/^0x/, ""),
        startTimestamp,
        durationDays,
      };
    })();
    session = pending;
    try {
      return await pending;
    } catch (error) {
      if (session === pending) session = undefined;
      throw error;
    }
  }

  return {
    getCachedDecryption,
    getVersion: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => {
      generation++;
      session = undefined;
      expiresAt = 0;
      cache.clear();
      notify();
    },
    async userDecrypt(
      pairs: Pair[],
      sign: SignTypedDataFn,
    ): Promise<Map<string, bigint>> {
      if (!userAddress)
        throw new Error(
          `Connect a wallet on chain ${scope.chainId} to decrypt.`,
        );
      if (pairs.some((pair) => !contains(pair.contractAddress))) {
        throw new Error("Contract is outside this feature's decryption scope.");
      }
      if (pairs.some((pair) => pair.handle.toLowerCase() === ZERO_HANDLE)) {
        throw new Error("Cannot decrypt an uninitialized ciphertext handle.");
      }
      const started = generation;
      const out = new Map<string, bigint>();
      const missing = pairs.filter((pair) => {
        const value = getCachedDecryption(pair.handle, pair.contractAddress);
        if (value !== undefined) out.set(pair.handle, value);
        return value === undefined;
      });
      if (!missing.length) return out;

      const s = await getSession(sign);
      const sdk = await loadSDK();
      assertCurrent(started);
      const results = await sdk.userDecrypt(
        missing,
        s.keypair.privateKey,
        s.keypair.publicKey,
        s.signature,
        contracts,
        userAddress,
        s.startTimestamp,
        s.durationDays,
      );
      assertCurrent(started);
      // Validate the complete response before exposing any of its values.
      const response = results as Record<string, unknown>;
      const values = missing.map((pair) => {
        if (!Object.hasOwn(response, pair.handle)) {
          throw new Error("The relayer returned an invalid decryption result.");
        }
        const value = response[pair.handle];
        if (typeof value !== "bigint") {
          throw new Error("The relayer returned an invalid decryption result.");
        }
        return value;
      });
      missing.forEach((pair, index) => {
        cache.set(key(pair), values[index]);
        out.set(pair.handle, values[index]);
      });
      notify();
      return out;
    },
  };
}
