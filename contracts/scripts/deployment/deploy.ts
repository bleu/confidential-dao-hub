import type { DeployFunction } from "hardhat-deploy/types";

import { verifyAndExportDeployment } from "./export";
import { deploymentEnvironment, type DeploymentFeature } from "./feature";
import {
  assertDeploymentConfirmation,
  assertNoExistingSepoliaDeployment,
  getDeploymentGasSettings,
  getExpectedDeployerAddress,
  runSepoliaPreflight,
  SEPOLIA_CHAIN_ID,
} from "./preflight";
import { loadRuntimeArtifact } from "./provenance";

const LOCAL_NETWORK_NAMES = new Set(["hardhat", "localhost", "anvil"]);
const LOCAL_CHAIN_ID = 31_337n;

export function createFeatureDeployment(feature: DeploymentFeature): DeployFunction {
  const deployFeature: DeployFunction = async (hre) => {
    const { deployer } = await hre.getNamedAccounts();
    const artifact = await loadRuntimeArtifact(hre, feature);
    const network = await hre.ethers.provider.getNetwork();
    let preflight;

    if (LOCAL_NETWORK_NAMES.has(hre.network.name)) {
      if (network.chainId !== LOCAL_CHAIN_ID) throw new Error("Local deployment requires chain ID 31337.");
    } else {
      if (network.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Deployment requires Sepolia chain ID 11155111.");
      assertNoExistingSepoliaDeployment((await hre.deployments.getOrNull(feature.contractName))?.address);
      preflight = await runSepoliaPreflight({
        artifact,
        feature,
        expectedDeployer: getExpectedDeployerAddress(),
        gasSettings: getDeploymentGasSettings(feature),
        provider: hre.ethers.provider,
        signer: deployer,
      });
      if (!preflight.confirmation || !preflight.gasSettings) throw new Error("Deployment gas caps are required.");
      assertDeploymentConfirmation(process.env[deploymentEnvironment(feature).confirmation], preflight.confirmation);
    }

    const approvedGasSettings = preflight?.gasSettings;
    if (preflight && !approvedGasSettings) throw new Error("Deployment gas caps are required.");
    const deployment = await hre.deployments.deploy(feature.contractName, {
      contract: artifact,
      args: [],
      from: deployer,
      log: true,
      ...(preflight && approvedGasSettings
        ? {
            gasLimit: approvedGasSettings.gasLimit.toString(),
            maxFeePerGas: approvedGasSettings.maxFeePerGas.toString(),
            nonce: preflight.nonce,
          }
        : {}),
    });

    if (preflight) {
      if (!deployment.transactionHash) throw new Error("Deployment did not return a transaction hash.");
      const transaction = await hre.ethers.provider.getTransaction(deployment.transactionHash);
      const receipt = await hre.ethers.provider.getTransactionReceipt(deployment.transactionHash);
      await verifyAndExportDeployment({
        artifact,
        feature,
        chainId: SEPOLIA_CHAIN_ID,
        contractAddress: deployment.address,
        deployer: preflight.signer,
        configuration: preflight.configuration,
        nonce: preflight.nonce,
        provider: hre.ethers.provider,
        receipt,
        repositoryRoot: hre.config.paths.root,
        transaction,
        transactionHash: deployment.transactionHash,
      });
    }
  };
  deployFeature.id = feature.deploymentId;
  deployFeature.tags = [feature.contractName];
  return deployFeature;
}
