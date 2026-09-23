import { keccak256 } from "ethers";

import { EMPTY_CONFIGURATION, type DeploymentFeature } from "../deployment/feature";

export const SEPOLIA_MOCK_TOKEN_ADDRESS = "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA";

export const payrollDeployment: DeploymentFeature = {
  key: "payroll",
  contractName: "ConfidentialMultisend",
  deploymentId: "deploy_confidential_multisend_v1",
  envPrefix: "PAYROLL",
  async inspectConfiguration(provider) {
    const code = await provider.getCode(SEPOLIA_MOCK_TOKEN_ADDRESS);
    if (code === "0x") throw new Error("The configured Sepolia mock token has no deployed code.");
    return {
      ...EMPTY_CONFIGURATION,
      token: {
        address: SEPOLIA_MOCK_TOKEN_ADDRESS,
        codeHash: keccak256(code),
        compatibility: "code-presence-only",
      },
    };
  },
};
