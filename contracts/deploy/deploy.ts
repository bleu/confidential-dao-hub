import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// 1,000,000 tokens at 6 decimals — initial treasury supply for both demo tokens.
const INITIAL_SUPPLY = 1_000_000_000_000n;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const cToken = await deploy("ConfidentialGovToken", {
    from: deployer,
    args: ["Confidential Governance Token", "cTOKEN", INITIAL_SUPPLY],
    log: true,
  });

  // Payment leg: use the official Zama Sepolia cUSDT if provided via env var,
  // otherwise deploy our own mintable confidential-token mock (demo fallback).
  let cUsdtAddress = process.env.CUSDT_ADDRESS;
  if (!cUsdtAddress) {
    const cUsdt = await deploy("ConfidentialUSDT", {
      contract: "ConfidentialGovToken",
      from: deployer,
      args: ["Confidential USDT (Mock)", "cUSDT", INITIAL_SUPPLY],
      log: true,
    });
    cUsdtAddress = cUsdt.address;
  }

  const vault = await deploy("BuybackVault", {
    from: deployer,
    args: [cToken.address, cUsdtAddress],
    log: true,
  });

  console.log(`ConfidentialGovToken: ${cToken.address}`);
  console.log(`cUSDT:                ${cUsdtAddress}`);
  console.log(`BuybackVault:         ${vault.address}`);
};

export default func;
func.id = "deploy_confidential_buybacks"; // id required to prevent reexecution
func.tags = ["ConfidentialBuybacks"];
