import type { Provider } from "ethers";

export interface DeploymentConfiguration {
  administrator: string | null;
  constructorArguments: unknown[];
  dependencies: { name: string; address: string; codeHash: string }[];
  token?: {
    address: string;
    codeHash: string;
    compatibility: "code-presence-only";
  };
}

export interface DeploymentContract {
  name: string;
  artifactName: string;
  args?: (addresses: Readonly<Record<string, string>>) => unknown[];
  dependencies?: string[];
  immutableAddresses?: (addresses: Readonly<Record<string, string>>) => Record<string, string>;
  administrator?: "deployer";
  externalAddress?: string;
}

export interface DeploymentFeature {
  key: string;
  tag: string;
  deploymentId: string;
  envPrefix: string;
  contracts: (input: NodeJS.ProcessEnv) => DeploymentContract[];
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
