import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { verifyAndExportDeployment } from "./export";
import { deploymentEnvironment, EMPTY_CONFIGURATION, type DeploymentFeature } from "./feature";
import {
  getDeploymentGasSettings,
  getExpectedDeployerAddress,
  runSepoliaPreflight,
  SEPOLIA_CHAIN_ID,
} from "./preflight";
import { loadRuntimeArtifact } from "./provenance";

export async function runPreflightCommand(hre: HardhatRuntimeEnvironment, feature: DeploymentFeature): Promise<void> {
  const keys = deploymentEnvironment(feature);
  const hasGasLimit = process.env[keys.gasLimit] !== undefined;
  const hasMaxFee = process.env[keys.maxFeePerGas] !== undefined;
  if (hasGasLimit !== hasMaxFee) throw new Error(`Set both ${keys.gasLimit} and ${keys.maxFeePerGas}.`);
  const { deployer } = await hre.getNamedAccounts();
  const result = await runSepoliaPreflight({
    artifact: await loadRuntimeArtifact(hre, feature),
    feature,
    expectedDeployer: getExpectedDeployerAddress(),
    gasSettings: hasGasLimit ? getDeploymentGasSettings(feature) : undefined,
    provider: hre.ethers.provider,
    signer: deployer,
  });

  console.log(`feature: ${feature.key}`);
  console.log(`chainId: ${SEPOLIA_CHAIN_ID}`);
  console.log(`signer: ${result.signer}`);
  console.log(`nonce: ${result.nonce}`);
  console.log(`artifactHash: ${result.artifactHash}`);
  console.log(`nativeBalanceWei: ${result.nativeBalance}`);
  console.log(`gasEstimate: ${result.gasEstimate}`);
  console.log(`networkFeePerGasWei: ${result.networkFeePerGas}`);
  console.log(`suggestedGasLimit: ${result.suggestedGasSettings.gasLimit}`);
  console.log(`suggestedMaxFeePerGasWei: ${result.suggestedGasSettings.maxFeePerGas}`);
  if (!result.gasSettings || !result.confirmation || result.gasBudget === undefined) {
    console.log(`Set ${keys.gasLimit} and ${keys.maxFeePerGas}, then run preflight again.`);
    return;
  }
  console.log(`gasLimit: ${result.gasSettings.gasLimit}`);
  console.log(`maxFeePerGasWei: ${result.gasSettings.maxFeePerGas}`);
  console.log(`gasBudgetWei: ${result.gasBudget}`);
  console.log(`${keys.confirmation}=${result.confirmation}`);
}

export async function runVerifyCommand(hre: HardhatRuntimeEnvironment, feature: DeploymentFeature): Promise<void> {
  const provider = hre.ethers.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Deployment records are exported only for Sepolia.");
  const deployment = await hre.deployments.get(feature.contractName);
  if (!deployment.transactionHash) throw new Error("The deployment has no transaction hash.");
  const transaction = await provider.getTransaction(deployment.transactionHash);
  const receipt = await provider.getTransactionReceipt(deployment.transactionHash);
  if (!transaction) throw new Error("Deployment transaction is unavailable.");
  await verifyAndExportDeployment({
    artifact: await loadRuntimeArtifact(hre, feature),
    feature,
    chainId: network.chainId,
    contractAddress: deployment.address,
    deployer: transaction.from,
    configuration: feature.inspectConfiguration ? await feature.inspectConfiguration(provider) : EMPTY_CONFIGURATION,
    nonce: transaction.nonce,
    provider,
    receipt,
    repositoryRoot: hre.config.paths.root,
    transaction,
    transactionHash: deployment.transactionHash,
  });
  console.log(`Verified and exported ${feature.key}: ${deployment.address}`);
}
