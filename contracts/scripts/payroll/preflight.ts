import hre, { ethers } from "hardhat";

import { safeCommandError } from "./deployment/errors";
import { getDeploymentGasSettings, getExpectedDeployerAddress, runSepoliaPreflight } from "./deployment/preflight";
import { loadPayrollRuntimeArtifact } from "./deployment/provenance";

function configuredGasSettings() {
  const hasGasLimit = process.env.PAYROLL_DEPLOY_GAS_LIMIT !== undefined;
  const hasMaxFee = process.env.PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI !== undefined;
  if (hasGasLimit !== hasMaxFee) {
    throw new Error("Set both PAYROLL_DEPLOY_GAS_LIMIT and PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI.");
  }
  return hasGasLimit ? getDeploymentGasSettings() : undefined;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const artifact = await loadPayrollRuntimeArtifact(hre);
  const result = await runSepoliaPreflight({
    artifact,
    expectedDeployer: getExpectedDeployerAddress(),
    gasSettings: configuredGasSettings(),
    provider: ethers.provider,
    signer: deployer.address,
  });

  console.log(`chainId: ${11_155_111}`);
  console.log(`signer: ${result.signer}`);
  console.log(`nonce: ${result.nonce}`);
  console.log(`artifactHash: ${result.artifactHash}`);
  console.log(`nativeBalanceWei: ${result.nativeBalance}`);
  console.log(`gasEstimate: ${result.gasEstimate}`);
  console.log(`networkFeePerGasWei: ${result.networkFeePerGas}`);
  console.log(`suggestedGasLimit: ${result.suggestedGasSettings.gasLimit}`);
  console.log(`suggestedMaxFeePerGasWei: ${result.suggestedGasSettings.maxFeePerGas}`);
  if (!result.gasSettings || !result.confirmation || result.gasBudget === undefined) {
    console.log("Set PAYROLL_DEPLOY_GAS_LIMIT and PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI, then run preflight again.");
    return;
  }
  console.log(`gasLimit: ${result.gasSettings.gasLimit}`);
  console.log(`maxFeePerGasWei: ${result.gasSettings.maxFeePerGas}`);
  console.log(`gasBudgetWei: ${result.gasBudget}`);
  console.log(`PAYROLL_DEPLOY_CONFIRMATION=${result.confirmation}`);
}

main().catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
