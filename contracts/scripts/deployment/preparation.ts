import { readdir } from "node:fs/promises";

import { getAddress, keccak256 } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { assertDeploymentTransaction, verifyAndExportDeployment } from "./export";
import {
  EMPTY_CONFIGURATION,
  type DeploymentConfiguration,
  type DeploymentContract,
  type DeploymentFeature,
} from "./feature";
import { SEPOLIA_CHAIN_ID } from "./preflight";
import {
  deploymentRecordDirectory,
  getCreationData,
  loadRuntimeArtifact,
  validateImmutableAddresses,
  verifyRuntimeBytecode,
  type RuntimeArtifact,
} from "./provenance";

export interface PreparedFeature {
  artifacts: ReadonlyMap<string, RuntimeArtifact>;
  baseConfiguration: DeploymentConfiguration;
  contracts: readonly DeploymentContract[];
  externalDependencies: readonly DeploymentConfiguration["dependencies"][number][];
  feature: DeploymentFeature;
  useNamedRecords: boolean;
}

export interface PreparedDeploymentStep {
  args: unknown[];
  artifact: RuntimeArtifact;
  configuration: DeploymentConfiguration;
  contract: DeploymentContract;
  creationData: string;
  immutableAddresses: Record<string, string>;
}

export interface DeploymentProgress {
  addresses: Readonly<Record<string, string>>;
  complete: boolean;
  pending?: PreparedDeploymentStep;
  pendingIndex?: number;
}

function serializableValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializableValue(item)]),
    );
  }
  return value;
}

function normalizeAddress(address: string, name: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new Error(`${name} must be a valid address.`);
  }
}

function validateContracts(contracts: readonly DeploymentContract[]): void {
  if (contracts.length === 0) throw new Error("Deployment features must define at least one contract.");
  const names = new Set<string>();
  for (const contract of contracts) {
    if (!contract.name || !contract.artifactName)
      throw new Error("Deployment contracts need a name and artifact name.");
    if (names.has(contract.name)) throw new Error(`Deployment contract ${contract.name} is defined more than once.`);
    for (const dependency of contract.dependencies ?? []) {
      if (!names.has(dependency)) {
        throw new Error(`Deployment dependency ${dependency} must be declared before ${contract.name}.`);
      }
    }
    if (contract.externalAddress && contract.dependencies?.length) {
      throw new Error(`External deployment ${contract.name} cannot have deployment dependencies.`);
    }
    names.add(contract.name);
  }
}

function appendDependencies(
  baseDependencies: readonly DeploymentConfiguration["dependencies"][number][],
  additions: readonly DeploymentConfiguration["dependencies"][number][],
): DeploymentConfiguration["dependencies"] {
  const dependencies = [...baseDependencies];
  for (const addition of additions) {
    const existing = dependencies.find((dependency) => dependency.name === addition.name);
    if (existing && (existing.address !== addition.address || existing.codeHash !== addition.codeHash)) {
      throw new Error(`Deployment dependency ${addition.name} has conflicting values.`);
    }
    if (!existing) dependencies.push(addition);
  }
  return dependencies;
}

async function codeDependency(
  provider: Pick<HardhatRuntimeEnvironment["ethers"]["provider"], "getCode">,
  name: string,
  address: string,
): Promise<DeploymentConfiguration["dependencies"][number]> {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`Deployment dependency ${name} has no deployed code.`);
  return { address: normalizeAddress(address, `Deployment dependency ${name}`), codeHash: keccak256(code), name };
}

export async function prepareFeature(
  hre: HardhatRuntimeEnvironment,
  feature: DeploymentFeature,
  options: { inspectConfiguration?: boolean } = {},
): Promise<PreparedFeature> {
  const contracts = feature.contracts(process.env);
  validateContracts(contracts);
  const artifacts = new Map(
    await Promise.all(
      contracts.map(
        async (contract) => [contract.name, await loadRuntimeArtifact(hre, contract.artifactName)] as const,
      ),
    ),
  );
  const externalDependencies = await Promise.all(
    contracts
      .filter(
        (contract): contract is DeploymentContract & { externalAddress: string } =>
          contract.externalAddress !== undefined,
      )
      .map((contract) => codeDependency(hre.ethers.provider, contract.name, contract.externalAddress)),
  );
  const baseConfiguration =
    options.inspectConfiguration === false || !feature.inspectConfiguration
      ? EMPTY_CONFIGURATION
      : await feature.inspectConfiguration(hre.ethers.provider);

  return {
    artifacts,
    baseConfiguration,
    contracts,
    externalDependencies,
    feature,
    useNamedRecords: contracts.length > 1,
  };
}

async function prepareStep(options: {
  addresses: Readonly<Record<string, string>>;
  administrator: string;
  contract: DeploymentContract;
  prepared: PreparedFeature;
  provider: Pick<HardhatRuntimeEnvironment["ethers"]["provider"], "getCode">;
}): Promise<PreparedDeploymentStep> {
  const artifact = options.prepared.artifacts.get(options.contract.name);
  if (!artifact) throw new Error(`Deployment artifact for ${options.contract.name} is unavailable.`);
  const args = options.contract.args?.(options.addresses) ?? [];
  const dependencyNames = options.contract.dependencies ?? [];
  const dependencies = await Promise.all(
    dependencyNames.map((name) => {
      const address = options.addresses[name];
      if (!address) throw new Error(`Deployment dependency ${name} is unavailable for ${options.contract.name}.`);
      return codeDependency(options.provider, name, address);
    }),
  );
  const immutableAddresses = options.contract.immutableAddresses?.(options.addresses) ?? {};
  validateImmutableAddresses(artifact, immutableAddresses);
  const base = options.prepared.baseConfiguration;
  return {
    args,
    artifact,
    configuration: {
      ...base,
      administrator:
        options.contract.administrator === "deployer"
          ? normalizeAddress(options.administrator, "Administrator")
          : base.administrator,
      constructorArguments: args.map(serializableValue),
      dependencies: appendDependencies(
        appendDependencies(base.dependencies, options.prepared.externalDependencies),
        dependencies,
      ),
    },
    contract: options.contract,
    creationData: await getCreationData(artifact, args),
    immutableAddresses,
  };
}

async function directoryHasFiles(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoPublicRecord(
  hre: HardhatRuntimeEnvironment,
  prepared: PreparedFeature,
  contract: DeploymentContract,
): Promise<void> {
  const directory = deploymentRecordDirectory(
    hre.config.paths.root,
    prepared.feature,
    prepared.useNamedRecords ? contract.name : undefined,
  );
  if (await directoryHasFiles(directory)) {
    throw new Error(
      `A public deployment record already exists for ${contract.name}, but its saved deployment is unavailable.`,
    );
  }
}

async function verifySavedStep(options: {
  addresses: Readonly<Record<string, string>>;
  contract: DeploymentContract;
  deployment: { address: string; transactionHash?: string };
  hre: HardhatRuntimeEnvironment;
  networkChainId: bigint;
  prepared: PreparedFeature;
  writeRecord: boolean;
}): Promise<void> {
  const transactionHash = options.deployment.transactionHash;
  if (!transactionHash) throw new Error(`Saved deployment ${options.contract.name} has no transaction hash.`);
  const [transaction, receipt] = await Promise.all([
    options.hre.ethers.provider.getTransaction(transactionHash),
    options.hre.ethers.provider.getTransactionReceipt(transactionHash),
  ]);
  if (!transaction) throw new Error(`Saved deployment transaction for ${options.contract.name} is unavailable.`);
  const step = await prepareStep({
    addresses: options.addresses,
    administrator: transaction.from,
    contract: options.contract,
    prepared: options.prepared,
    provider: options.hre.ethers.provider,
  });
  if (options.networkChainId === SEPOLIA_CHAIN_ID) {
    await verifyAndExportDeployment({
      artifact: step.artifact,
      chainId: options.networkChainId,
      configuration: step.configuration,
      contractAddress: options.deployment.address,
      creationData: step.creationData,
      deployer: transaction.from,
      deploymentName: options.prepared.useNamedRecords ? step.contract.name : undefined,
      feature: options.prepared.feature,
      immutableAddresses: step.immutableAddresses,
      nonce: transaction.nonce,
      provider: options.hre.ethers.provider,
      receipt,
      repositoryRoot: options.hre.config.paths.root,
      transaction,
      transactionHash,
      writeRecord: options.writeRecord,
    });
    return;
  }

  assertDeploymentTransaction({
    contractAddress: options.deployment.address,
    creationData: step.creationData,
    deployer: transaction.from,
    nonce: transaction.nonce,
    receipt,
    transaction,
  });
  verifyRuntimeBytecode(
    step.artifact,
    await options.hre.ethers.provider.getCode(options.deployment.address),
    step.immutableAddresses,
  );
}

export async function findDeploymentProgress(options: {
  hre: HardhatRuntimeEnvironment;
  networkChainId: bigint;
  prepared: PreparedFeature;
  signer: string;
  writeRecords?: boolean;
}): Promise<DeploymentProgress> {
  const addresses: Record<string, string> = Object.fromEntries(
    options.prepared.contracts
      .filter(
        (contract): contract is DeploymentContract & { externalAddress: string } =>
          contract.externalAddress !== undefined,
      )
      .map((contract) => [contract.name, normalizeAddress(contract.externalAddress, contract.name)]),
  );
  let pending: DeploymentContract | undefined;
  let pendingIndex: number | undefined;

  for (const [index, contract] of options.prepared.contracts.entries()) {
    const deployment = await options.hre.deployments.getOrNull(contract.name);
    if (contract.externalAddress) {
      if (deployment) throw new Error(`External deployment ${contract.name} must not have a saved deployment.`);
      continue;
    }
    if (!deployment) {
      if (options.networkChainId === SEPOLIA_CHAIN_ID)
        await assertNoPublicRecord(options.hre, options.prepared, contract);
      if (!pending) {
        pending = contract;
        pendingIndex = index;
      }
      continue;
    }
    if (pending) {
      throw new Error(
        `Saved deployment ${contract.name} follows missing deployment ${pending.name}. Refusing replacement.`,
      );
    }

    if (!options.prepared.artifacts.has(contract.name)) {
      throw new Error(`Deployment artifact for ${contract.name} is unavailable.`);
    }
    await verifySavedStep({
      addresses,
      contract,
      deployment,
      hre: options.hre,
      networkChainId: options.networkChainId,
      prepared: options.prepared,
      writeRecord: options.writeRecords ?? false,
    });
    addresses[contract.name] = normalizeAddress(deployment.address, `Saved deployment ${contract.name}`);
  }

  if (!pending || pendingIndex === undefined) return { addresses, complete: true };
  return {
    addresses,
    complete: false,
    pending: await prepareStep({
      addresses,
      administrator: options.signer,
      contract: pending,
      prepared: options.prepared,
      provider: options.hre.ethers.provider,
    }),
    pendingIndex,
  };
}

export async function verifyNewDeployment(options: {
  deployment: { address: string; transactionHash?: string };
  expectedNonce: number;
  hre: HardhatRuntimeEnvironment;
  networkChainId: bigint;
  prepared: PreparedFeature;
  step: PreparedDeploymentStep;
  signer: string;
}): Promise<void> {
  const transactionHash = options.deployment.transactionHash;
  if (!transactionHash) throw new Error(`Deployment ${options.step.contract.name} did not return a transaction hash.`);
  const [transaction, receipt] = await Promise.all([
    options.hre.ethers.provider.getTransaction(transactionHash),
    options.hre.ethers.provider.getTransactionReceipt(transactionHash),
  ]);
  if (options.networkChainId === SEPOLIA_CHAIN_ID) {
    await verifyAndExportDeployment({
      artifact: options.step.artifact,
      chainId: options.networkChainId,
      configuration: options.step.configuration,
      contractAddress: options.deployment.address,
      creationData: options.step.creationData,
      deployer: options.signer,
      deploymentName: options.prepared.useNamedRecords ? options.step.contract.name : undefined,
      feature: options.prepared.feature,
      immutableAddresses: options.step.immutableAddresses,
      nonce: options.expectedNonce,
      provider: options.hre.ethers.provider,
      receipt,
      repositoryRoot: options.hre.config.paths.root,
      transaction,
      transactionHash,
    });
    return;
  }

  assertDeploymentTransaction({
    contractAddress: options.deployment.address,
    creationData: options.step.creationData,
    deployer: options.signer,
    nonce: options.expectedNonce,
    receipt,
    transaction,
  });
  verifyRuntimeBytecode(
    options.step.artifact,
    await options.hre.ethers.provider.getCode(options.deployment.address),
    options.step.immutableAddresses,
  );
}
