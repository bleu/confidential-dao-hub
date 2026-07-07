import { FhevmType } from "@fhevm/hardhat-plugin";
import { deployments, ethers, fhevm } from "hardhat";

async function main() {
  await fhevm.initializeCLIApi();
  const [treasury] = await ethers.getSigners();

  const vaultDeployment = await deployments.get("BuybackVault");
  const vault = await ethers.getContractAt("BuybackVault", vaultDeployment.address);

  console.log(`hasOpenEpoch: ${await vault.hasOpenEpoch()}`);
  const epochId = await vault.currentEpochId();
  const e = await vault.getEpoch(epochId);
  console.log(`epoch ${epochId}: price=${e.price} open=${e.open} openedAt=${e.openedAt}`);

  const budget = await fhevm.userDecryptEuint(FhevmType.euint64, e.budget, vaultDeployment.address, treasury);
  const remaining = await fhevm.userDecryptEuint(FhevmType.euint64, e.remaining, vaultDeployment.address, treasury);
  console.log(`decrypted budget:    ${budget}`);
  console.log(`decrypted remaining: ${remaining}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
