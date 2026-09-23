import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  await hre.deployments.deploy("ConfidentialVesting", {
    from: deployer,
    args: [],
    log: true,
  });
};

export default func;
func.id = "deploy_confidential_vesting_v1";
func.tags = ["ConfidentialVesting"];
