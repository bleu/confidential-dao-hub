import type { DeployFunction } from "hardhat-deploy/types";

import { deploymentEnvironment, type DeploymentFeature } from "./feature";
import {
  findDeploymentProgress,
  prepareFeature,
  verifyNewDeployment,
  type PreparedDeploymentStep,
  type PreparedFeature,
} from "./preparation";
import {
  assertDeploymentConfirmation,
  getDeploymentGasSettings,
  getExpectedDeployerAddress,
  runSepoliaPreflight,
  SEPOLIA_CHAIN_ID,
} from "./preflight";

const LOCAL_NETWORK_NAMES = new Set(["hardhat", "localhost", "anvil"]);
const LOCAL_CHAIN_ID = 31_337n;

function logCompletedDeployments(prepared: PreparedFeature, addresses: Readonly<Record<string, string>>): void {
  for (const contract of prepared.contracts) {
    const address = addresses[contract.name];
    if (address) console.log(`${contract.name}: ${address}`);
  }
}

async function deployStep(options: {
  hre: Parameters<DeployFunction>[0];
  gasSettings?: { gasLimit: bigint; maxFeePerGas: bigint };
  nonce?: number;
  signer: string;
  step: PreparedDeploymentStep;
}) {
  const deployment = await options.hre.deployments.deploy(options.step.contract.name, {
    args: options.step.args,
    contract: options.step.artifact,
    from: options.signer,
    log: true,
    ...(options.gasSettings
      ? {
          gasLimit: options.gasSettings.gasLimit.toString(),
          maxFeePerGas: options.gasSettings.maxFeePerGas.toString(),
        }
      : {}),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
  if (!deployment.newlyDeployed) {
    throw new Error(
      `Deployment ${options.step.contract.name} already exists. Refusing to replace or trust a changed deployment.`,
    );
  }
  return deployment;
}

export function createFeatureDeployment(feature: DeploymentFeature): DeployFunction {
  const deployFeature: DeployFunction = async (hre) => {
    const { deployer } = await hre.getNamedAccounts();
    const network = await hre.ethers.provider.getNetwork();
    const chainId = BigInt(network.chainId);
    const prepared = await prepareFeature(hre, feature, { inspectConfiguration: chainId === SEPOLIA_CHAIN_ID });

    if (LOCAL_NETWORK_NAMES.has(hre.network.name)) {
      if (chainId !== LOCAL_CHAIN_ID) throw new Error("Local deployment requires chain ID 31337.");
      while (true) {
        const progress = await findDeploymentProgress({
          hre,
          networkChainId: chainId,
          prepared,
          signer: deployer,
        });
        if (progress.complete) {
          logCompletedDeployments(prepared, progress.addresses);
          return undefined;
        }
        if (!progress.pending) throw new Error("Deployment progress has no pending contract.");
        const expectedNonce = await hre.ethers.provider.getTransactionCount(deployer, "pending");
        const deployment = await deployStep({
          hre,
          nonce: expectedNonce,
          signer: deployer,
          step: progress.pending,
        });
        await verifyNewDeployment({
          deployment,
          expectedNonce,
          hre,
          networkChainId: chainId,
          prepared,
          signer: deployer,
          step: progress.pending,
        });
      }
    }

    if (chainId !== SEPOLIA_CHAIN_ID) throw new Error("Deployment requires Sepolia chain ID 11155111.");
    const progress = await findDeploymentProgress({
      hre,
      networkChainId: chainId,
      prepared,
      signer: deployer,
    });
    if (progress.complete) {
      logCompletedDeployments(prepared, progress.addresses);
      return undefined;
    }
    if (!progress.pending) throw new Error("Deployment progress has no pending contract.");

    const preflight = await runSepoliaPreflight({
      artifact: progress.pending.artifact,
      configuration: progress.pending.configuration,
      creationData: progress.pending.creationData,
      deploymentName: progress.pending.contract.name,
      expectedDeployer: getExpectedDeployerAddress(),
      feature,
      gasSettings: getDeploymentGasSettings(feature),
      provider: hre.ethers.provider,
      signer: deployer,
    });
    if (!preflight.confirmation || !preflight.gasSettings) throw new Error("Deployment gas caps are required.");
    assertDeploymentConfirmation(process.env[deploymentEnvironment(feature).confirmation], preflight.confirmation);

    const deployment = await deployStep({
      gasSettings: preflight.gasSettings,
      hre,
      nonce: preflight.nonce,
      signer: deployer,
      step: progress.pending,
    });
    await verifyNewDeployment({
      deployment,
      expectedNonce: preflight.nonce,
      hre,
      networkChainId: chainId,
      prepared,
      signer: preflight.signer,
      step: progress.pending,
    });
    return undefined;
  };
  deployFeature.id = feature.deploymentId;
  deployFeature.tags = [feature.tag];
  return deployFeature;
}
