import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { verifyAndExportPayrollDeployment } from "../scripts/payroll/deployment/export";
import {
  assertDeploymentConfirmation,
  assertNoExistingSepoliaDeployment,
  getDeploymentGasSettings,
  getExpectedDeployerAddress,
  runSepoliaPreflight,
  SEPOLIA_CHAIN_ID,
} from "../scripts/payroll/deployment/preflight";
import { loadPayrollRuntimeArtifact } from "../scripts/payroll/deployment/provenance";

const LOCAL_NETWORK_NAMES = new Set(["hardhat", "localhost", "anvil"]);
const LOCAL_CHAIN_ID = 31_337n;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const artifact = await loadPayrollRuntimeArtifact(hre);
  const network = await hre.ethers.provider.getNetwork();
  let preflight;

  if (LOCAL_NETWORK_NAMES.has(hre.network.name)) {
    if (network.chainId !== LOCAL_CHAIN_ID) throw new Error("Local payroll deployment requires chain ID 31337.");
  } else {
    if (network.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Payroll deployment requires Sepolia chain ID 11155111.");
    assertNoExistingSepoliaDeployment((await hre.deployments.getOrNull("ConfidentialMultisend"))?.address);
    const expectedDeployer = getExpectedDeployerAddress();
    const gasSettings = getDeploymentGasSettings();
    preflight = await runSepoliaPreflight({
      artifact,
      expectedDeployer,
      gasSettings,
      provider: hre.ethers.provider,
      signer: deployer,
    });
    if (!preflight.confirmation || !preflight.gasSettings) throw new Error("Payroll deployment gas caps are required.");
    assertDeploymentConfirmation(process.env.PAYROLL_DEPLOY_CONFIRMATION, preflight.confirmation);
  }

  const approvedGasSettings = preflight?.gasSettings;
  if (preflight && !approvedGasSettings) throw new Error("Payroll deployment gas caps are required.");

  const deployment = await deploy("ConfidentialMultisend", {
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
    if (!deployment.transactionHash) throw new Error("Payroll deployment did not return a transaction hash.");
    const transaction = await hre.ethers.provider.getTransaction(deployment.transactionHash);
    const receipt = await hre.ethers.provider.getTransactionReceipt(deployment.transactionHash);
    await verifyAndExportPayrollDeployment({
      artifact,
      chainId: SEPOLIA_CHAIN_ID,
      contractAddress: deployment.address,
      deployer: preflight.signer,
      mockToken: {
        address: preflight.mockTokenAddress,
        codeHash: preflight.mockTokenCodeHash,
      },
      nonce: preflight.nonce,
      provider: hre.ethers.provider,
      receipt,
      repositoryRoot: process.cwd(),
      transaction,
      transactionHash: deployment.transactionHash,
    });
  }
};

export default func;
func.id = "deploy_confidential_multisend_v1";
func.tags = ["ConfidentialMultisend"];
