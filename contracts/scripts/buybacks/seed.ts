import { deployments, ethers, fhevm } from "hardhat";

const T = 10n ** 6n;
const VAULT_FUNDING = 100_000n * T; // cUSDT escrowed for payouts
const EPOCH_BUDGET = 1_000n * T; // encrypted buyback budget (cTOKEN)

async function main() {
  await fhevm.initializeCLIApi();
  const [treasury] = await ethers.getSigners();
  console.log(`Treasury: ${treasury.address}`);

  const cUsdtDeployment = await deployments.get("ConfidentialUSDT");
  const vaultDeployment = await deployments.get("BuybackVault");
  const cUsdt = await ethers.getContractAt("ConfidentialGovToken", cUsdtDeployment.address);
  const vault = await ethers.getContractAt("BuybackVault", vaultDeployment.address);
  const vaultAddress = vaultDeployment.address;

  if (await vault.hasOpenEpoch()) {
    console.log("An epoch is already open — nothing to seed.");
    return;
  }

  console.log(`Funding vault with ${VAULT_FUNDING / T} cUSDT...`);
  const encFund = await fhevm
    .createEncryptedInput(cUsdtDeployment.address, treasury.address)
    .add64(VAULT_FUNDING)
    .encrypt();
  const fundTx = await cUsdt["confidentialTransfer(address,bytes32,bytes)"](
    vaultAddress,
    encFund.handles[0],
    encFund.inputProof,
  );
  await fundTx.wait();
  console.log(`Funded: ${fundTx.hash}`);

  console.log(`Opening the pool (encrypted budget ${EPOCH_BUDGET / T} cTOKEN)...`);
  const encBudget = await fhevm.createEncryptedInput(vaultAddress, treasury.address).add64(EPOCH_BUDGET).encrypt();
  const openTx = await vault.openEpoch(encBudget.handles[0], encBudget.inputProof);
  await openTx.wait();
  console.log(`Window ${await vault.currentEpochId()} open: ${openTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
