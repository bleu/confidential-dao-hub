import { getAddress, keccak256 } from "ethers";

import type { RuntimeArtifact } from "./provenance";

export const SEPOLIA_CHAIN_ID = 11_155_111n;
export const DEFAULT_HARDHAT_DEPLOYER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const SEPOLIA_MOCK_TOKEN_ADDRESS = "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA";

export interface DeploymentGasSettings {
  gasLimit: bigint;
  maxFeePerGas: bigint;
}

export interface ReadOnlyDeploymentProvider {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  getBalance(address: string): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getFeeData(): Promise<{ gasPrice: bigint | null; maxFeePerGas: bigint | null }>;
  estimateGas(transaction: { from: string; data: string }): Promise<bigint>;
  getTransactionCount(address: string, blockTag?: string): Promise<number>;
}

export interface SepoliaPreflightResult {
  artifactHash: string;
  confirmation?: string;
  expectedDeployer: string;
  gasBudget?: bigint;
  gasEstimate: bigint;
  gasSettings?: DeploymentGasSettings;
  mockTokenAddress: string;
  mockTokenCodeHash: string;
  nativeBalance: bigint;
  networkFeePerGas: bigint;
  nonce: number;
  signer: string;
  suggestedGasSettings: DeploymentGasSettings;
}

export interface SepoliaPreflightOptions {
  artifact: Pick<RuntimeArtifact, "bytecode">;
  expectedDeployer?: string;
  gasSettings?: DeploymentGasSettings;
  mockTokenAddress?: string;
  provider: ReadOnlyDeploymentProvider;
  signer: string;
}

function normalizeAddress(address: string, name: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new Error(`${name} must be a valid address.`);
  }
}

function parsePositiveInteger(value: string | undefined, name: string): bigint {
  if (!value || !/^\d+$/.test(value) || BigInt(value) === 0n) throw new Error(`${name} must be a positive integer.`);
  return BigInt(value);
}

export function assertNoExistingSepoliaDeployment(existingAddress: string | undefined): void {
  if (existingAddress)
    throw new Error("A Sepolia payroll deployment already exists. Run verify-deployment.ts instead.");
}

export function getExpectedDeployerAddress(value = process.env.EXPECTED_DEPLOYER_ADDRESS): string {
  if (!value) throw new Error("EXPECTED_DEPLOYER_ADDRESS is required for a Sepolia payroll deployment.");
  return normalizeAddress(value, "EXPECTED_DEPLOYER_ADDRESS");
}

export function getDeploymentGasSettings(input = process.env): DeploymentGasSettings {
  return {
    gasLimit: parsePositiveInteger(input.PAYROLL_DEPLOY_GAS_LIMIT, "PAYROLL_DEPLOY_GAS_LIMIT"),
    maxFeePerGas: parsePositiveInteger(input.PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI, "PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI"),
  };
}

export function getArtifactHash(artifact: Pick<RuntimeArtifact, "bytecode">): string {
  return keccak256(artifact.bytecode);
}

export function calculateGasBudget(gasSettings: DeploymentGasSettings): bigint {
  return gasSettings.gasLimit * gasSettings.maxFeePerGas;
}

export function suggestGasSettings(gasEstimate: bigint, networkFeePerGas: bigint): DeploymentGasSettings {
  return {
    gasLimit: (gasEstimate * 12n + 9n) / 10n,
    maxFeePerGas: networkFeePerGas,
  };
}

export function buildDeploymentConfirmation(input: {
  artifactHash: string;
  chainId: bigint;
  gasSettings: DeploymentGasSettings;
  nonce: number;
  signer: string;
}): string {
  return [
    "payroll-deploy-v1",
    input.chainId.toString(),
    getAddress(input.signer).toLowerCase(),
    input.artifactHash.toLowerCase(),
    input.nonce.toString(),
    input.gasSettings.gasLimit.toString(),
    input.gasSettings.maxFeePerGas.toString(),
  ].join(":");
}

export function assertDeploymentConfirmation(value: string | undefined, expected: string): void {
  if (value !== expected) {
    throw new Error(
      "PAYROLL_DEPLOY_CONFIRMATION must match the current chain, signer, artifact hash, pending nonce, and gas caps.",
    );
  }
}

export async function runSepoliaPreflight(options: SepoliaPreflightOptions): Promise<SepoliaPreflightResult> {
  const signer = normalizeAddress(options.signer, "Deployer");
  const expectedDeployer = getExpectedDeployerAddress(options.expectedDeployer);
  const defaultDeployer = getAddress(DEFAULT_HARDHAT_DEPLOYER_ADDRESS);
  if (signer === defaultDeployer) throw new Error("The known Hardhat default deployer cannot deploy to Sepolia.");
  if (signer !== expectedDeployer) throw new Error("The configured deployer does not match EXPECTED_DEPLOYER_ADDRESS.");

  const network = await options.provider.getNetwork();
  const chainId = BigInt(network.chainId);
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error("Payroll deployment requires Sepolia chain ID 11155111.");

  const mockTokenAddress = normalizeAddress(options.mockTokenAddress ?? SEPOLIA_MOCK_TOKEN_ADDRESS, "Mock token");
  const mockTokenCode = await options.provider.getCode(mockTokenAddress);
  if (mockTokenCode === "0x") throw new Error("The configured Sepolia mock token has no deployed code.");

  const feeData = await options.provider.getFeeData();
  const networkFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (networkFeePerGas === null || networkFeePerGas <= 0n) {
    throw new Error("Could not determine a positive deployment gas price.");
  }
  const gasEstimate = await options.provider.estimateGas({ from: signer, data: options.artifact.bytecode });
  const nativeBalance = await options.provider.getBalance(signer);
  const nonce = await options.provider.getTransactionCount(signer, "pending");
  const artifactHash = getArtifactHash(options.artifact);
  const suggestedGasSettings = suggestGasSettings(gasEstimate, networkFeePerGas);

  if (!options.gasSettings) {
    return {
      artifactHash,
      expectedDeployer,
      gasEstimate,
      mockTokenAddress,
      mockTokenCodeHash: keccak256(mockTokenCode),
      nativeBalance,
      networkFeePerGas,
      nonce,
      signer,
      suggestedGasSettings,
    };
  }

  const gasSettings = options.gasSettings;
  if (gasSettings.maxFeePerGas < networkFeePerGas) {
    throw new Error("PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI is below the current network fee.");
  }
  if (gasSettings.gasLimit < gasEstimate) {
    throw new Error("PAYROLL_DEPLOY_GAS_LIMIT is below the deployment gas estimate.");
  }
  const gasBudget = calculateGasBudget(gasSettings);
  if (nativeBalance < gasBudget) throw new Error("Deployer native balance is below the deployment gas budget.");

  return {
    artifactHash,
    confirmation: buildDeploymentConfirmation({ artifactHash, chainId, gasSettings, nonce, signer }),
    expectedDeployer,
    gasBudget,
    gasEstimate,
    gasSettings,
    mockTokenAddress,
    mockTokenCodeHash: keccak256(mockTokenCode),
    nativeBalance,
    networkFeePerGas,
    nonce,
    signer,
    suggestedGasSettings,
  };
}
