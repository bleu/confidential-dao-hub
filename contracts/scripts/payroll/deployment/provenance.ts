import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { keccak256, toUtf8Bytes } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const PAYROLL_SOURCE_NAME = "src/payroll/ConfidentialMultisend.sol";
const PAYROLL_FULLY_QUALIFIED_NAME = `${PAYROLL_SOURCE_NAME}:ConfidentialMultisend`;

export interface ImmutableReference {
  length: number;
  start: number;
}

export interface RuntimeArtifact {
  abi: unknown;
  bytecode: string;
  compiledSourceHash: string;
  compilerInputHash: string;
  compilerSettings: unknown;
  contractName: string;
  deployedBytecode: string;
  immutableReferences?: Record<string, ImmutableReference[]>;
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
  configuration: {
    administrator: null;
    constructorArguments: [];
    dependencies: [];
    token: {
      address: string;
      codeHash: string;
      compatibility: "code-presence-only";
    };
  };
  contractAddress: string;
  contractName: string;
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hexWithoutPrefix(bytecode: string): string {
  if (!/^0x[\da-fA-F]*$/.test(bytecode) || bytecode.length % 2 !== 0) throw new Error("Bytecode must be hexadecimal.");
  return bytecode.slice(2);
}

function immutableReferenceList(artifact: Pick<RuntimeArtifact, "immutableReferences">): ImmutableReference[] {
  return Object.values(artifact.immutableReferences ?? {}).flat();
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
  artifact: Pick<RuntimeArtifact, "deployedBytecode" | "immutableReferences">,
  deployedBytecode: string,
): RuntimeBytecodeVerification {
  if (deployedBytecode === "0x") throw new Error("No runtime bytecode exists at the deployment address.");
  const immutableReferences = immutableReferenceList(artifact);
  if (immutableReferences.length > 0) {
    throw new Error("Runtime bytecode has immutable references that require explicit value verification.");
  }
  hexWithoutPrefix(artifact.deployedBytecode);
  hexWithoutPrefix(deployedBytecode);
  if (artifact.deployedBytecode.toLowerCase() !== deployedBytecode.toLowerCase()) {
    throw new Error("Deployed runtime bytecode does not match the payroll artifact.");
  }
  return {
    deployedRuntimeBytecodeHash: keccak256(deployedBytecode),
    immutableReferenceCount: 0,
    normalizedRuntimeBytecodeHash: keccak256(deployedBytecode),
  };
}

export function getCompilerVersion(metadata: string): string {
  const compilerVersion = (JSON.parse(metadata) as { compiler?: { version?: unknown } }).compiler?.version;
  if (typeof compilerVersion !== "string" || compilerVersion.length === 0) {
    throw new Error("Artifact metadata does not include a compiler version.");
  }
  return compilerVersion;
}

export async function loadPayrollRuntimeArtifact(hre: HardhatRuntimeEnvironment): Promise<RuntimeArtifact> {
  const artifact = await hre.deployments.getArtifact("ConfidentialMultisend");
  const buildInfo = await hre.artifacts.getBuildInfo(PAYROLL_FULLY_QUALIFIED_NAME);
  if (!buildInfo) throw new Error("Compiled payroll build information is unavailable.");
  const contractOutput = buildInfo.output.contracts[PAYROLL_SOURCE_NAME]?.ConfidentialMultisend as
    | {
        evm: { deployedBytecode: { immutableReferences?: Record<string, ImmutableReference[]> } };
        metadata?: string;
      }
    | undefined;
  const source = buildInfo.input.sources[PAYROLL_SOURCE_NAME]?.content;
  if (!contractOutput?.metadata || source === undefined) {
    throw new Error("Compiled payroll metadata or source is unavailable.");
  }
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    compiledSourceHash: sha256(source),
    compilerInputHash: sha256(JSON.stringify(buildInfo.input)),
    compilerSettings: buildInfo.input.settings,
    contractName: artifact.contractName,
    deployedBytecode: artifact.deployedBytecode,
    immutableReferences: contractOutput.evm.deployedBytecode.immutableReferences,
    metadata: contractOutput.metadata,
    sourceName: artifact.sourceName,
  };
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

export async function writeDeploymentRecord(options: {
  directory: string;
  record: DeploymentRecord;
  abi: unknown;
}): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  const abiPath = join(options.directory, "ConfidentialMultisend.abi.json");
  const recordPath = join(options.directory, "deployment.json");
  const abiContents = `${JSON.stringify(options.abi, null, 2)}\n`;
  const recordContents = `${JSON.stringify(options.record, null, 2)}\n`;
  try {
    const [existingAbi, existingRecord] = await Promise.all([readFile(abiPath, "utf8"), readFile(recordPath, "utf8")]);
    if (existingAbi !== abiContents) throw new Error(`Existing deployment record differs at ${abiPath}.`);
    const parsedRecord = JSON.parse(existingRecord) as DeploymentRecord;
    if (JSON.stringify(deploymentInvariants(parsedRecord)) !== JSON.stringify(deploymentInvariants(options.record))) {
      throw new Error(`Existing deployment record differs at ${recordPath}.`);
    }
    return;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await Promise.all([
    writeFile(abiPath, abiContents, { flag: "wx" }),
    writeFile(recordPath, recordContents, { flag: "wx" }),
  ]);
}

export function deploymentRecordDirectory(repositoryRoot: string): string {
  return join(repositoryRoot, "deployment-records", "payroll", "sepolia");
}

export function sourceFileForArtifact(contractsRoot: string, artifact: Pick<RuntimeArtifact, "sourceName">): string {
  return join(contractsRoot, artifact.sourceName);
}

export async function buildDeploymentRecord(options: {
  artifact: RuntimeArtifact;
  blockNumber: number;
  chainId: bigint;
  contractAddress: string;
  deployedBytecode: string;
  deployer: string;
  mockToken: { address: string; codeHash: string };
  nonce: number;
  repositoryRoot: string;
  sourceFile: string;
  transactionHash: string;
}): Promise<DeploymentRecord> {
  const currentSourceHash = await getSourceHash(options.sourceFile);
  return {
    abiFile: "ConfidentialMultisend.abi.json",
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
    configuration: {
      administrator: null,
      constructorArguments: [],
      dependencies: [],
      token: {
        address: options.mockToken.address,
        codeHash: options.mockToken.codeHash,
        compatibility: "code-presence-only",
      },
    },
    contractAddress: options.contractAddress,
    contractName: options.artifact.contractName,
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
    verifiedRuntime: verifyRuntimeBytecode(options.artifact, options.deployedBytecode),
  };
}
