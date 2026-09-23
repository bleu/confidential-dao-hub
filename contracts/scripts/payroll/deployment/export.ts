import { getAddress, type Provider } from "ethers";

import { SEPOLIA_CHAIN_ID } from "./preflight";
import {
  buildDeploymentRecord,
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
  artifact: Pick<RuntimeArtifact, "bytecode">;
  contractAddress: string;
  deployer: string;
  nonce: number;
  receipt: DeploymentReceipt | null;
  transaction: DeploymentTransaction | null;
}): asserts options is typeof options & { receipt: DeploymentReceipt; transaction: DeploymentTransaction } {
  if (!options.receipt || options.receipt.status !== 1)
    throw new Error("Payroll deployment transaction did not succeed.");
  if (!options.transaction) throw new Error("Payroll deployment transaction is unavailable.");
  if (options.transaction.to !== null) throw new Error("Payroll deployment transaction must be a contract creation.");
  if (options.transaction.data.toLowerCase() !== options.artifact.bytecode.toLowerCase()) {
    throw new Error("Payroll deployment transaction bytecode does not match the artifact.");
  }
  if (getAddress(options.receipt.contractAddress ?? "") !== getAddress(options.contractAddress)) {
    throw new Error("Payroll deployment receipt contract address does not match the deployment.");
  }
  if (
    getAddress(options.transaction.from) !== getAddress(options.deployer) ||
    options.transaction.nonce !== options.nonce
  ) {
    throw new Error("Payroll deployment transaction signer or nonce does not match the approved deployment.");
  }
}

export async function verifyAndExportPayrollDeployment(options: {
  artifact: RuntimeArtifact;
  chainId: bigint;
  contractAddress: string;
  deployer: string;
  mockToken: { address: string; codeHash: string };
  nonce: number;
  provider: Pick<Provider, "getCode">;
  receipt: DeploymentReceipt | null;
  repositoryRoot: string;
  transaction: DeploymentTransaction | null;
  transactionHash: string;
}): Promise<void> {
  if (options.chainId !== SEPOLIA_CHAIN_ID)
    throw new Error("Payroll deployment records are exported only for Sepolia.");
  assertDeploymentTransaction(options);
  const deployedBytecode = await options.provider.getCode(options.contractAddress);
  const record = await buildDeploymentRecord({
    artifact: options.artifact,
    blockNumber: options.receipt.blockNumber,
    chainId: options.chainId,
    contractAddress: options.contractAddress,
    deployedBytecode,
    deployer: options.deployer,
    mockToken: options.mockToken,
    nonce: options.nonce,
    repositoryRoot: options.repositoryRoot,
    sourceFile: sourceFileForArtifact(options.repositoryRoot, options.artifact),
    transactionHash: options.transactionHash,
  });
  await writeDeploymentRecord({
    abi: options.artifact.abi,
    directory: deploymentRecordDirectory(options.repositoryRoot),
    record,
  });
}
