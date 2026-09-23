import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { deploymentEnvironment, type DeploymentFeature } from "./feature";
import { findDeploymentProgress, prepareFeature } from "./preparation";
import {
  getDeploymentGasSettings,
  getExpectedDeployerAddress,
  runSepoliaPreflight,
  SEPOLIA_CHAIN_ID,
} from "./preflight";

export async function runPreflightCommand(hre: HardhatRuntimeEnvironment, feature: DeploymentFeature): Promise<void> {
  const keys = deploymentEnvironment(feature);
  const hasGasLimit = process.env[keys.gasLimit] !== undefined;
  const hasMaxFee = process.env[keys.maxFeePerGas] !== undefined;
  if (hasGasLimit !== hasMaxFee) throw new Error(`Set both ${keys.gasLimit} and ${keys.maxFeePerGas}.`);
  const { deployer } = await hre.getNamedAccounts();
  const network = await hre.ethers.provider.getNetwork();
  if (BigInt(network.chainId) !== SEPOLIA_CHAIN_ID) throw new Error("Deployment requires Sepolia chain ID 11155111.");
  const prepared = await prepareFeature(hre, feature);
  const progress = await findDeploymentProgress({
    hre,
    networkChainId: SEPOLIA_CHAIN_ID,
    prepared,
    signer: deployer,
  });
  if (progress.complete) {
    console.log(`feature: ${feature.key}`);
    console.log("deployment: complete");
    return;
  }
  if (!progress.pending) throw new Error("Deployment progress has no pending contract.");
  const result = await runSepoliaPreflight({
    artifact: progress.pending.artifact,
    configuration: progress.pending.configuration,
    creationData: progress.pending.creationData,
    deploymentName: progress.pending.contract.name,
    expectedDeployer: getExpectedDeployerAddress(),
    feature,
    gasSettings: hasGasLimit ? getDeploymentGasSettings(feature) : undefined,
    provider: hre.ethers.provider,
    signer: deployer,
  });

  console.log(`feature: ${feature.key}`);
  console.log(`contract: ${result.deploymentName}`);
  console.log(`chainId: ${SEPOLIA_CHAIN_ID}`);
  console.log(`signer: ${result.signer}`);
  console.log(`nonce: ${result.nonce}`);
  console.log(`artifactHash: ${result.artifactHash}`);
  console.log(`creationDataHash: ${result.creationDataHash}`);
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
  const network = await hre.ethers.provider.getNetwork();
  if (BigInt(network.chainId) !== SEPOLIA_CHAIN_ID)
    throw new Error("Deployment records are exported only for Sepolia.");
  const { deployer } = await hre.getNamedAccounts();
  const prepared = await prepareFeature(hre, feature);
  const progress = await findDeploymentProgress({
    hre,
    networkChainId: SEPOLIA_CHAIN_ID,
    prepared,
    signer: deployer,
    writeRecords: true,
  });
  if (!progress.complete) {
    throw new Error(
      `Deployment ${progress.pending?.contract.name ?? "state"} is still pending. Run the approved deployment command.`,
    );
  }
  console.log(`Verified and exported ${feature.key}.`);
}
