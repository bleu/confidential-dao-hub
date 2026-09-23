import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ContractFactory, getAddress, keccak256, toUtf8Bytes, zeroPadValue, type InterfaceAbi } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { ABI } from "hardhat-deploy/types";

import type { DeploymentConfiguration, DeploymentFeature } from "./feature";

export interface ImmutableReference {
  length: number;
  start: number;
}

export interface ImmutableName {
  name: string;
  type: string;
}

export interface RuntimeArtifact {
  abi: ABI;
  bytecode: string;
  compiledSourceHash: string;
  compilerInputHash: string;
  compilerSettings: unknown;
  contractName: string;
  deployedBytecode: string;
  immutableNames: Record<string, ImmutableName>;
  immutableReferences?: Record<string, ImmutableReference[]>;
  linkReferences?: Record<string, Record<string, ImmutableReference[]>>;
  metadata: string;
  sourceName: string;
}

export interface RuntimeBytecodeVerification {
  deployedRuntimeBytecodeHash: string;
  immutableReferenceCount: number;
  normalizedRuntimeBytecodeHash: string;
}

export interface DeploymentRecord {
  abiFile: string;
  artifact: {
    abiHash: string;
    compiledSourceHash: string;
    compilerInputHash: string;
    creationBytecodeHash: string;
    runtimeBytecodeHash: string;
  };
  blockNumber: number;
  chainId: string;
  compiler: {
    settings: unknown;
    version: string;
  };
  configuration: DeploymentConfiguration;
  contractAddress: string;
  contractName: string;
  creationDataHash?: string;
  deploymentName?: string;
  deployer: string;
  gitCommit: string;
  nonce: number;
  schemaVersion: 1;
  source: {
    currentHash: string;
    matchesCompiledSource: boolean;
  };
  sourceName: string;
  transactionHash: string;
  verifiedRuntime: RuntimeBytecodeVerification;
}

type SupportedImmutableReference = ImmutableReference & {
  name: ImmutableName;
};

type BuildInfoOutput = {
  contracts: Record<
    string,
    Record<
      string,
      {
        evm: { deployedBytecode: { immutableReferences?: Record<string, ImmutableReference[]> } };
        metadata?: string;
      }
    >
  >;
  sources?: Record<string, { ast?: unknown }>;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hexWithoutPrefix(bytecode: string): string {
  if (!/^0x[\da-fA-F]*$/.test(bytecode) || bytecode.length % 2 !== 0) throw new Error("Bytecode must be hexadecimal.");
  return bytecode.slice(2);
}

function immutableReferenceEntries(
  artifact: Pick<RuntimeArtifact, "immutableReferences">,
): [string, ImmutableReference[]][] {
  return Object.entries(artifact.immutableReferences ?? {}).filter(([, references]) => references.length > 0);
}

function immutableReferenceList(artifact: Pick<RuntimeArtifact, "immutableReferences">): ImmutableReference[] {
  return immutableReferenceEntries(artifact).flatMap(([, references]) => references);
}

function isAddressOrContractImmutable(type: string): boolean {
  return type === "address" || type === "address payable" || type.startsWith("contract ");
}

function supportedImmutableReferences(
  artifact: Pick<RuntimeArtifact, "deployedBytecode" | "immutableNames" | "immutableReferences">,
  bytecode: string,
): SupportedImmutableReference[] {
  const bytecodeLength = hexWithoutPrefix(bytecode).length / 2;
  const references: SupportedImmutableReference[] = [];

  for (const [id, immutableReferences] of immutableReferenceEntries(artifact)) {
    const immutableName = artifact.immutableNames?.[id];
    if (!immutableName || !immutableName.name || !immutableName.type) {
      throw new Error(`Immutable bytecode reference ${id} has no mapped variable metadata.`);
    }
    if (!isAddressOrContractImmutable(immutableName.type)) {
      throw new Error(`Immutable bytecode reference ${immutableName.name} is not an address or contract.`);
    }
    for (const reference of immutableReferences) {
      if (
        !Number.isSafeInteger(reference.start) ||
        !Number.isSafeInteger(reference.length) ||
        reference.start < 0 ||
        reference.length !== 32 ||
        reference.start + reference.length > bytecodeLength
      ) {
        throw new Error("Immutable bytecode reference must be a 32-byte range inside the runtime bytecode.");
      }
      references.push({ ...reference, name: immutableName });
    }
  }

  const sortedReferences = [...references].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sortedReferences.length; index += 1) {
    const previous = sortedReferences[index - 1];
    const current = sortedReferences[index];
    if (current.start < previous.start + previous.length) {
      throw new Error("Immutable bytecode references overlap.");
    }
  }

  return references;
}

function immutableAddressesForReferences(
  references: SupportedImmutableReference[],
  immutableAddresses: Record<string, string>,
): Map<string, string> {
  const requiredNames = new Set(references.map((reference) => reference.name.name));
  for (const name of Object.keys(immutableAddresses)) {
    if (!requiredNames.has(name)) throw new Error(`Immutable address ${name} does not match a runtime immutable.`);
  }

  const addresses = new Map<string, string>();
  for (const name of requiredNames) {
    const address = immutableAddresses[name];
    if (address === undefined) throw new Error(`Immutable address ${name} is missing.`);
    addresses.set(name, zeroPadValue(getAddress(address), 32).slice(2).toLowerCase());
  }
  return addresses;
}

export function validateImmutableAddresses(
  artifact: Pick<RuntimeArtifact, "deployedBytecode" | "immutableNames" | "immutableReferences">,
  immutableAddresses: Record<string, string> = {},
): void {
  immutableAddressesForReferences(
    supportedImmutableReferences(artifact, artifact.deployedBytecode),
    immutableAddresses,
  );
}

export function normalizeRuntimeBytecode(
  bytecode: string,
  immutableReferences: RuntimeArtifact["immutableReferences"],
): string {
  const hex = hexWithoutPrefix(bytecode);
  const characters = hex.split("");
  for (const reference of immutableReferenceList({ immutableReferences })) {
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    if (reference.start < 0 || reference.length <= 0 || end > characters.length) {
      throw new Error("Immutable bytecode reference is outside the runtime bytecode.");
    }
    characters.fill("0", start, end);
  }
  return `0x${characters.join("")}`;
}

export function verifyRuntimeBytecode(
  artifact: Pick<RuntimeArtifact, "deployedBytecode" | "immutableNames" | "immutableReferences">,
  deployedBytecode: string,
  immutableAddresses: Record<string, string> = {},
): RuntimeBytecodeVerification {
  if (deployedBytecode === "0x") throw new Error("No runtime bytecode exists at the deployment address.");
  hexWithoutPrefix(artifact.deployedBytecode);
  hexWithoutPrefix(deployedBytecode);

  const immutableReferences = supportedImmutableReferences(artifact, artifact.deployedBytecode);
  supportedImmutableReferences(artifact, deployedBytecode);
  const addresses = immutableAddressesForReferences(immutableReferences, immutableAddresses);
  const deployedRuntime = hexWithoutPrefix(deployedBytecode).toLowerCase();
  for (const reference of immutableReferences) {
    const expectedAddress = addresses.get(reference.name.name);
    if (!expectedAddress) throw new Error(`Immutable address ${reference.name.name} is missing.`);
    const value = deployedRuntime.slice(reference.start * 2, (reference.start + reference.length) * 2);
    if (value !== expectedAddress) {
      throw new Error(`Runtime immutable ${reference.name.name} does not match the expected address.`);
    }
  }

  const normalizedArtifact = normalizeRuntimeBytecode(artifact.deployedBytecode, artifact.immutableReferences);
  const normalizedDeployedBytecode = normalizeRuntimeBytecode(deployedBytecode, artifact.immutableReferences);
  if (normalizedArtifact.toLowerCase() !== normalizedDeployedBytecode.toLowerCase()) {
    throw new Error("Deployed runtime bytecode does not match the artifact.");
  }
  return {
    deployedRuntimeBytecodeHash: keccak256(deployedBytecode),
    immutableReferenceCount: immutableReferences.length,
    normalizedRuntimeBytecodeHash: keccak256(normalizedDeployedBytecode),
  };
}

export function getCompilerVersion(metadata: string): string {
  const compilerVersion = (JSON.parse(metadata) as { compiler?: { version?: unknown } }).compiler?.version;
  if (typeof compilerVersion !== "string" || compilerVersion.length === 0) {
    throw new Error("Artifact metadata does not include a compiler version.");
  }
  return compilerVersion;
}

export function assertSupportedArtifact(
  artifact: Pick<
    RuntimeArtifact,
    "abi" | "bytecode" | "deployedBytecode" | "immutableNames" | "immutableReferences" | "linkReferences"
  >,
): void {
  if (
    Object.values(artifact.linkReferences ?? {}).some((libraries) =>
      Object.values(libraries).some((references) => references.length > 0),
    )
  ) {
    throw new Error("Shared deployment does not support linked libraries.");
  }
  if (artifact.bytecode === "0x") throw new Error("Deployment artifact has no creation bytecode.");
  hexWithoutPrefix(artifact.bytecode);
  supportedImmutableReferences(artifact, artifact.deployedBytecode);
}

function immutableNamesFromAsts(
  sources: BuildInfoOutput["sources"],
  immutableReferenceIds: Set<string>,
): Record<string, ImmutableName> {
  const immutableNames: Record<string, ImmutableName> = {};
  const visited = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const node = value as Record<string, unknown>;
    if (
      node.nodeType === "VariableDeclaration" &&
      node.mutability === "immutable" &&
      typeof node.id === "number" &&
      immutableReferenceIds.has(node.id.toString()) &&
      typeof node.name === "string" &&
      typeof node.typeDescriptions === "object" &&
      node.typeDescriptions !== null
    ) {
      const type = (node.typeDescriptions as Record<string, unknown>).typeString;
      if (typeof type === "string") immutableNames[node.id.toString()] = { name: node.name, type };
    }
    for (const child of Object.values(node)) visit(child);
  };

  for (const source of Object.values(sources ?? {})) visit(source.ast);
  return immutableNames;
}

export async function loadRuntimeArtifact(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
): Promise<RuntimeArtifact> {
  const artifact = await hre.artifacts.readArtifact(contractName);
  const buildInfo = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${artifact.contractName}`);
  if (!buildInfo) throw new Error("Compiled deployment build information is unavailable.");
  const output = buildInfo.output as unknown as BuildInfoOutput;
  const contractOutput = output.contracts[artifact.sourceName]?.[artifact.contractName];
  const source = buildInfo.input.sources[artifact.sourceName]?.content;
  if (!contractOutput?.metadata || source === undefined) {
    throw new Error("Compiled deployment metadata or source is unavailable.");
  }
  const immutableReferences = contractOutput.evm.deployedBytecode.immutableReferences;
  const runtimeArtifact: RuntimeArtifact = {
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    compiledSourceHash: sha256(source),
    compilerInputHash: sha256(JSON.stringify(buildInfo.input)),
    compilerSettings: buildInfo.input.settings,
    contractName: artifact.contractName,
    deployedBytecode: artifact.deployedBytecode,
    immutableNames: immutableNamesFromAsts(output.sources, new Set(Object.keys(immutableReferences ?? {}))),
    immutableReferences,
    linkReferences: artifact.linkReferences,
    metadata: contractOutput.metadata,
    sourceName: artifact.sourceName,
  };
  assertSupportedArtifact(runtimeArtifact);
  return runtimeArtifact;
}

export async function getCreationData(
  artifact: Pick<RuntimeArtifact, "abi" | "bytecode">,
  args: unknown[],
): Promise<string> {
  const transaction = await new ContractFactory(artifact.abi as InterfaceAbi, artifact.bytecode).getDeployTransaction(
    ...args,
  );
  if (typeof transaction.data !== "string" || transaction.data === "0x") {
    throw new Error("Deployment artifact has no creation data.");
  }
  hexWithoutPrefix(transaction.data);
  return transaction.data;
}

export async function getSourceHash(sourceFile: string): Promise<string> {
  return sha256(await readFile(sourceFile));
}

export function getGitCommit(repositoryRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function deploymentInvariants(record: DeploymentRecord): Omit<DeploymentRecord, "gitCommit" | "source"> {
  const { gitCommit: _gitCommit, source: _source, ...invariants } = record;
  return invariants;
}

type DeploymentRecordFiles = {
  abi?: string;
  record?: string;
};

async function readDeploymentRecordFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function deploymentRecordFiles(options: {
  directory: string;
  record: DeploymentRecord;
  abi: unknown;
}): Promise<DeploymentRecordFiles> {
  const abiPath = join(options.directory, options.record.abiFile);
  const recordPath = join(options.directory, "deployment.json");
  const abiContents = `${JSON.stringify(options.abi, null, 2)}\n`;
  const [existingAbi, existingRecord] = await Promise.all([
    readDeploymentRecordFile(abiPath),
    readDeploymentRecordFile(recordPath),
  ]);
  if (existingAbi !== undefined && existingAbi !== abiContents) {
    throw new Error(`Existing deployment record differs at ${abiPath}.`);
  }
  if (existingRecord !== undefined) {
    const parsedRecord = JSON.parse(existingRecord) as DeploymentRecord;
    if (JSON.stringify(deploymentInvariants(parsedRecord)) !== JSON.stringify(deploymentInvariants(options.record))) {
      throw new Error(`Existing deployment record differs at ${recordPath}.`);
    }
  }
  return { abi: existingAbi, record: existingRecord };
}

export async function checkDeploymentRecord(options: {
  directory: string;
  record: DeploymentRecord;
  abi: unknown;
}): Promise<boolean> {
  const existing = await deploymentRecordFiles(options);
  return existing.abi !== undefined && existing.record !== undefined;
}

export async function writeDeploymentRecord(options: {
  directory: string;
  record: DeploymentRecord;
  abi: unknown;
}): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  const existing = await deploymentRecordFiles(options);
  if (existing.abi !== undefined && existing.record !== undefined) return;

  const abiPath = join(options.directory, options.record.abiFile);
  const recordPath = join(options.directory, "deployment.json");
  const abiContents = `${JSON.stringify(options.abi, null, 2)}\n`;
  const recordContents = `${JSON.stringify(options.record, null, 2)}\n`;
  await Promise.all([
    ...(existing.abi === undefined ? [writeFile(abiPath, abiContents, { flag: "wx" })] : []),
    ...(existing.record === undefined ? [writeFile(recordPath, recordContents, { flag: "wx" })] : []),
  ]);
}

export function deploymentRecordDirectory(
  repositoryRoot: string,
  feature: DeploymentFeature,
  deploymentName?: string,
): string {
  const directory = join(repositoryRoot, "deployment-records", feature.key, "sepolia");
  return deploymentName !== undefined ? join(directory, deploymentName) : directory;
}

export function sourceFileForArtifact(contractsRoot: string, artifact: Pick<RuntimeArtifact, "sourceName">): string {
  return join(contractsRoot, artifact.sourceName);
}

export async function buildDeploymentRecord(options: {
  artifact: RuntimeArtifact;
  blockNumber: number;
  chainId: bigint;
  contractAddress: string;
  creationData: string;
  deployedBytecode: string;
  deployer: string;
  configuration: DeploymentConfiguration;
  deploymentName?: string;
  immutableAddresses?: Record<string, string>;
  nonce: number;
  repositoryRoot: string;
  sourceFile: string;
  transactionHash: string;
}): Promise<DeploymentRecord> {
  const currentSourceHash = await getSourceHash(options.sourceFile);
  const creationDataHash =
    options.configuration.constructorArguments.length > 0 || options.deploymentName !== undefined
      ? keccak256(options.creationData)
      : undefined;
  return {
    abiFile: `${options.deploymentName ?? options.artifact.contractName}.abi.json`,
    artifact: {
      abiHash: keccak256(toUtf8Bytes(JSON.stringify(options.artifact.abi))),
      compiledSourceHash: options.artifact.compiledSourceHash,
      compilerInputHash: options.artifact.compilerInputHash,
      creationBytecodeHash: keccak256(options.artifact.bytecode),
      runtimeBytecodeHash: keccak256(options.artifact.deployedBytecode),
    },
    blockNumber: options.blockNumber,
    chainId: options.chainId.toString(),
    compiler: {
      settings: options.artifact.compilerSettings,
      version: getCompilerVersion(options.artifact.metadata),
    },
    configuration: options.configuration,
    contractAddress: options.contractAddress,
    contractName: options.artifact.contractName,
    ...(creationDataHash ? { creationDataHash } : {}),
    ...(options.deploymentName !== undefined ? { deploymentName: options.deploymentName } : {}),
    deployer: options.deployer,
    gitCommit: getGitCommit(options.repositoryRoot),
    nonce: options.nonce,
    schemaVersion: 1,
    source: {
      currentHash: currentSourceHash,
      matchesCompiledSource: currentSourceHash === options.artifact.compiledSourceHash,
    },
    sourceName: options.artifact.sourceName,
    transactionHash: options.transactionHash,
    verifiedRuntime: verifyRuntimeBytecode(options.artifact, options.deployedBytecode, options.immutableAddresses),
  };
}
