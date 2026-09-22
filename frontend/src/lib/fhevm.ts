"use client";

import { toHex } from "viem";

/** Browser-only SDK loading, encryption, and public disclosure.
 * Private decryption state belongs to a feature's DecryptionProvider.
 */
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
// Official UMD build; the package's `/bundle` entry is just a re-export of
// window.relayerSDK, so the CDN script must load first (documented SSR setup).
const SDK_CDN_URL =
  "https://cdn.zama.org/relayer-sdk-js/0.4.4/relayer-sdk-js.umd.cjs";

export type FhevmInstance = Awaited<
  ReturnType<typeof import("@zama-fhe/relayer-sdk/web").createInstance>
>;

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
    script.onerror = () =>
      reject(new Error("Failed to load the Zama relayer SDK from CDN"));
    document.head.appendChild(script);
  });
  if (!window.relayerSDK)
    throw new Error("Zama relayer SDK loaded but window.relayerSDK is missing");
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

/** Encrypts one or more euint64 inputs bound to (contract, user) under a single proof. */
export async function encryptValues(
  contractAddress: string,
  userAddress: string,
  values: bigint[],
): Promise<{ handles: `0x${string}`[]; proof: `0x${string}` }> {
  const fhe = await getFhevm();
  const input = fhe.createEncryptedInput(contractAddress, userAddress);
  for (const v of values) input.add64(v);
  const { handles, inputProof } = await input.encrypt();
  return { handles: handles.map((h) => toHex(h)), proof: toHex(inputProof) };
}

/** Encrypts a single euint64 input; returns calldata-ready hex. */
export async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const { handles, proof } = await encryptValues(contractAddress, userAddress, [
    value,
  ]);
  return { handle: handles[0], proof };
}

// Debug/testing hook: lets the console (and headless smoke tests) exercise the
// SDK init + encryption path without going through the UI.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__fhevm = {
    getFhevm,
    encryptAmount,
  };
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
    value: BigInt(
      results.clearValues[handle as `0x${string}`] as bigint | string,
    ),
    abiEncodedClearValues: results.abiEncodedClearValues,
    decryptionProof: results.decryptionProof,
  };
}
