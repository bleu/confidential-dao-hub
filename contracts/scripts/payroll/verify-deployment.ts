import hre, { deployments, ethers } from "hardhat";
import { keccak256 } from "ethers";

import { safeCommandError } from "./deployment/errors";
import { verifyAndExportPayrollDeployment } from "./deployment/export";
import { SEPOLIA_CHAIN_ID, SEPOLIA_MOCK_TOKEN_ADDRESS } from "./deployment/preflight";
import { loadPayrollRuntimeArtifact } from "./deployment/provenance";

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID)
    throw new Error("Payroll deployment records are exported only for Sepolia.");

  const deployment = await deployments.get("ConfidentialMultisend");
  if (!deployment.transactionHash) throw new Error("The payroll deployment has no transaction hash.");
  const transaction = await ethers.provider.getTransaction(deployment.transactionHash);
  const receipt = await ethers.provider.getTransactionReceipt(deployment.transactionHash);
  const mockTokenCode = await ethers.provider.getCode(SEPOLIA_MOCK_TOKEN_ADDRESS);
  if (mockTokenCode === "0x") throw new Error("The configured Sepolia mock token has no deployed code.");

  await verifyAndExportPayrollDeployment({
    artifact: await loadPayrollRuntimeArtifact(hre),
    chainId: network.chainId,
    contractAddress: deployment.address,
    deployer: transaction?.from ?? "0x0000000000000000000000000000000000000000",
    mockToken: {
      address: SEPOLIA_MOCK_TOKEN_ADDRESS,
      codeHash: keccak256(mockTokenCode),
    },
    nonce: transaction?.nonce ?? -1,
    provider: ethers.provider,
    receipt,
    repositoryRoot: process.cwd(),
    transaction,
    transactionHash: deployment.transactionHash,
  });

  console.log(`Verified and exported ${deployment.address}`);
}

main().catch((error: unknown) => {
  console.error(safeCommandError(error));
  process.exitCode = 1;
});
