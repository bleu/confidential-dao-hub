import { getAddress, type Provider } from "ethers";

import type { DeploymentConfiguration, DeploymentFeature } from "./feature";
import { SEPOLIA_CHAIN_ID } from "./preflight";
import {
  buildDeploymentRecord,
  checkDeploymentRecord,
  deploymentRecordDirectory,
  sourceFileForArtifact,
  writeDeploymentRecord,
  type RuntimeArtifact,
} from "./provenance";

export interface DeploymentReceipt {
  blockNumber: number;
  contractAddress: string | null;
  status: number | null;
}

export interface DeploymentTransaction {
  data: string;
  from: string;
  nonce: number;
  to: string | null;
}

export function assertDeploymentTransaction(options: {
  creationData: string;
  contractAddress: string;
  deployer: string;
  nonce: number;
  receipt: DeploymentReceipt | null;
  transaction: DeploymentTransaction | null;
}): asserts options is typeof options & { receipt: DeploymentReceipt; transaction: DeploymentTransaction } {
  if (!options.receipt || options.receipt.status !== 1) throw new Error("Deployment transaction did not succeed.");
  if (!options.transaction) throw new Error("Deployment transaction is unavailable.");
  if (options.transaction.to !== null) throw new Error("Deployment transaction must be a contract creation.");
  if (options.transaction.data.toLowerCase() !== options.creationData.toLowerCase()) {
    throw new Error("Deployment transaction data does not match the expected creation data.");
  }
  if (getAddress(options.receipt.contractAddress ?? "") !== getAddress(options.contractAddress)) {
    throw new Error("Deployment receipt contract address does not match the deployment.");
  }
  if (
    getAddress(options.transaction.from) !== getAddress(options.deployer) ||
    options.transaction.nonce !== options.nonce
  ) {
    throw new Error("Deployment transaction signer or nonce does not match the approved deployment.");
  }
}

export async function verifyAndExportDeployment(options: {
  feature: DeploymentFeature;
  artifact: RuntimeArtifact;
  chainId: bigint;
  contractAddress: string;
  creationData: string;
  deployer: string;
  configuration: DeploymentConfiguration;
  deploymentName?: string;
  immutableAddresses?: Record<string, string>;
  nonce: number;
  provider: Pick<Provider, "getCode">;
  receipt: DeploymentReceipt | null;
  repositoryRoot: string;
  transaction: DeploymentTransaction | null;
  transactionHash: string;
  writeRecord?: boolean;
}): Promise<void> {
  if (options.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Deployment records are exported only for Sepolia.");
  assertDeploymentTransaction(options);
  const deployedBytecode = await options.provider.getCode(options.contractAddress);
  const record = await buildDeploymentRecord({
    artifact: options.artifact,
    blockNumber: options.receipt.blockNumber,
    chainId: options.chainId,
    contractAddress: options.contractAddress,
    creationData: options.creationData,
    deployedBytecode,
    deployer: options.deployer,
    configuration: options.configuration,
    deploymentName: options.deploymentName,
    immutableAddresses: options.immutableAddresses,
    nonce: options.nonce,
    repositoryRoot: options.repositoryRoot,
    sourceFile: sourceFileForArtifact(options.repositoryRoot, options.artifact),
    transactionHash: options.transactionHash,
  });
  const recordOptions = {
    abi: options.artifact.abi,
    directory: deploymentRecordDirectory(options.repositoryRoot, options.feature, options.deploymentName),
    record,
  };
  if (options.writeRecord ?? true) {
    await writeDeploymentRecord(recordOptions);
  } else {
    await checkDeploymentRecord(recordOptions);
  }
}
