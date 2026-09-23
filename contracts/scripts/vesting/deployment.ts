import type { DeploymentFeature } from "../deployment/feature";

export const vestingDeployment: DeploymentFeature = {
  key: "vesting",
  contractName: "ConfidentialVesting",
  deploymentId: "deploy_confidential_vesting_v1",
  envPrefix: "VESTING",
};
