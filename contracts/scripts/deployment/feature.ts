import type { Provider } from "ethers";

export interface DeploymentConfiguration {
  administrator: null;
  constructorArguments: [];
  dependencies: [];
  token?: {
    address: string;
    codeHash: string;
    compatibility: "code-presence-only";
  };
}

export interface DeploymentFeature {
  key: string;
  contractName: string;
  deploymentId: string;
  envPrefix: string;
  inspectConfiguration?: (provider: Pick<Provider, "getCode">) => Promise<DeploymentConfiguration>;
}

export const EMPTY_CONFIGURATION: DeploymentConfiguration = {
  administrator: null,
  constructorArguments: [],
  dependencies: [],
};

export function deploymentEnvironment(feature: DeploymentFeature) {
  return {
    gasLimit: `${feature.envPrefix}_DEPLOY_GAS_LIMIT`,
    maxFeePerGas: `${feature.envPrefix}_DEPLOY_MAX_FEE_PER_GAS_WEI`,
    confirmation: `${feature.envPrefix}_DEPLOY_CONFIRMATION`,
  };
}
