import type { DeploymentFeature } from "../deployment/feature";

export const vestingDeployment: DeploymentFeature = {
  key: "vesting",
  tag: "ConfidentialVesting",
  contracts: () => [{ name: "ConfidentialVesting", artifactName: "ConfidentialVesting" }],
  deploymentId: "deploy_confidential_vesting_v1",
  envPrefix: "VESTING",
};
