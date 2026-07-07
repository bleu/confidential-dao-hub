"use client";

import { toHex } from "viem";

import { CONTRACTS } from "@/config/contracts";

/**
 * Thin client-side wrapper around @zama-fhe/relayer-sdk.
 *
 * - The SDK (WASM) is loaded lazily on first use, browser-only, via the
 *   prebundled `/bundle` entry (the official recommendation for SSR frameworks).
 * - userDecrypt requires an EIP-712 signature; we sign ONCE per session for all
 *   three contracts and cache the keypair + signature.
 * - Decrypted values are cached by handle for the session (handles are
 *   immutable ciphertexts, so this is always safe).
 */

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
// Official UMD build; the package's `/bundle` entry is just a re-export of
// window.relayerSDK, so the CDN script must load first (documented SSR setup).
const SDK_CDN_URL = "https://cdn.zama.org/relayer-sdk-js/0.4.4/relayer-sdk-js.umd.cjs";

type FhevmInstance = Awaited<ReturnType<typeof import("@zama-fhe/relayer-sdk/web").createInstance>>;

type RelayerSDK = {
  initSDK: () => Promise<boolean>;
  createInstance: (config: Record<string, unknown>) => Promise<FhevmInstance>;
  SepoliaConfig: Record<string, unknown>;
};

declare global {
  interface Window {
    relayerSDK?: RelayerSDK;
  }
}

let instancePromise: Promise<FhevmInstance> | null = null;

async function loadRelayerSDK(): Promise<RelayerSDK> {
  if (window.relayerSDK) return window.relayerSDK;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load the Zama relayer SDK from CDN"));
    document.head.appendChild(script);
  });
  if (!window.relayerSDK) throw new Error("Zama relayer SDK loaded but window.relayerSDK is missing");
  return window.relayerSDK;
}

export function getFhevm(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const sdk = await loadRelayerSDK();
      await sdk.initSDK();
      return sdk.createInstance({ ...sdk.SepoliaConfig, network: RPC_URL });
    })();
    instancePromise.catch(() => {
      instancePromise = null; // allow retry after a failed init
    });
  }
  return instancePromise;
}

/** Encrypts a euint64 input bound to (contract, user); returns calldata-ready hex. */
export async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const fhe = await getFhevm();
  const input = fhe.createEncryptedInput(contractAddress, userAddress);
  input.add64(value);
  const { handles, inputProof } = await input.encrypt();
  return { handle: toHex(handles[0]), proof: toHex(inputProof) };
}

// ---------------------------------------------------------------------------
// userDecrypt session (one EIP-712 signature covers all our contracts)
// ---------------------------------------------------------------------------

export type SignTypedDataFn = (args: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<`0x${string}`>;

type DecryptSession = {
  userAddress: string;
  keypair: { publicKey: string; privateKey: string };
  signature: string;
  startTimestamp: number;
  durationDays: number;
  contractAddresses: string[];
};

let session: DecryptSession | null = null;
const decryptedCache = new Map<string, bigint>();

export function getCachedDecryption(handle: string): bigint | undefined {
  if (handle === ZERO_HANDLE) return 0n;
  return decryptedCache.get(handle);
}

async function getSession(userAddress: string, signTypedData: SignTypedDataFn): Promise<DecryptSession> {
  if (session && session.userAddress.toLowerCase() === userAddress.toLowerCase()) return session;

  const fhe = await getFhevm();
  const keypair = fhe.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const contractAddresses = [CONTRACTS.vault, CONTRACTS.cToken, CONTRACTS.cUsdt];

  const eip712 = fhe.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signTypedData({
    domain: eip712.domain as unknown as Record<string, unknown>,
    types: { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification } as Record<string, unknown>,
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message as unknown as Record<string, unknown>,
  });

  session = {
    userAddress,
    keypair,
    signature: signature.replace("0x", ""),
    startTimestamp,
    durationDays,
    contractAddresses,
  };
  return session;
}

/** Clears the per-user decryption session (e.g. on account change). */
export function resetSession() {
  session = null;
}

/**
 * Decrypts euint64 handles for the connected user. The caller must have ACL
 * access to each handle (granted by the contracts via FHE.allow).
 */
export async function userDecrypt(
  pairs: { handle: string; contractAddress: string }[],
  userAddress: string,
  signTypedData: SignTypedDataFn,
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const missing = pairs.filter((p) => {
    const cached = getCachedDecryption(p.handle);
    if (cached !== undefined) out.set(p.handle, cached);
    return cached === undefined;
  });
  if (missing.length === 0) return out;

  const s = await getSession(userAddress, signTypedData);
  const fhe = await getFhevm();
  const results = await fhe.userDecrypt(
    missing.map((p) => ({ handle: p.handle, contractAddress: p.contractAddress })),
    s.keypair.privateKey,
    s.keypair.publicKey,
    s.signature,
    s.contractAddresses,
    s.userAddress,
    s.startTimestamp,
    s.durationDays,
  );
  for (const p of missing) {
    const value = BigInt(results[p.handle as `0x${string}`] as bigint | string);
    decryptedCache.set(p.handle, value);
    out.set(p.handle, value);
  }
  return out;
}

// Debug/testing hook: lets the console (and headless smoke tests) exercise the
// SDK init + encryption path without going through the UI.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__fhevm = { getFhevm, encryptAmount };
}

/** Publicly decrypts a handle (must be makePubliclyDecryptable on-chain). */
export async function publicDecrypt(handle: string): Promise<{
  value: bigint;
  abiEncodedClearValues: `0x${string}`;
  decryptionProof: `0x${string}`;
}> {
  const fhe = await getFhevm();
  const results = await fhe.publicDecrypt([handle]);
  return {
    value: BigInt(results.clearValues[handle as `0x${string}`] as bigint | string),
    abiEncodedClearValues: results.abiEncodedClearValues,
    decryptionProof: results.decryptionProof,
  };
}
