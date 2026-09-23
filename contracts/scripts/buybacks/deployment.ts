import { getAddress, ZeroAddress } from "ethers";

import type { DeploymentFeature } from "../deployment/feature";

const INITIAL_SUPPLY = 1_000_000_000_000n;

function uint64(value: string | undefined, fallback: bigint, name: string): bigint {
  if (value !== undefined && !/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer.`);
  const result = value === undefined ? fallback : BigInt(value);
  if (result > (1n << 64n) - 1n) throw new Error(`${name} exceeds uint64.`);
  return result;
}

export const buybacksDeployment: DeploymentFeature = {
  key: "buybacks",
  tag: "ConfidentialBuybacks",
  deploymentId: "deploy_confidential_buybacks_v2",
  envPrefix: "BUYBACKS",
  contracts(input) {
    const price = uint64(input.ORACLE_PRICE, 200n, "ORACLE_PRICE");
    const duration = uint64(input.EPOCH_DURATION, 900n, "EPOCH_DURATION");
    if (duration < 60n || duration > 30n * 24n * 60n * 60n) {
      throw new Error("EPOCH_DURATION must be between 60 seconds and 30 days.");
    }
    let externalAddress: string | undefined;
    if (input.CUSDT_ADDRESS) {
      try {
        externalAddress = getAddress(input.CUSDT_ADDRESS);
      } catch {
        throw new Error("CUSDT_ADDRESS must be a valid address.");
      }
      if (externalAddress === ZeroAddress) throw new Error("CUSDT_ADDRESS must not be zero.");
    }
    return [
      {
        name: "ConfidentialGovToken",
        artifactName: "ConfidentialGovToken",
        args: () => ["Confidential Governance Token", "cTOKEN", INITIAL_SUPPLY],
        administrator: "deployer",
      },
      {
        name: "ConfidentialUSDT",
        artifactName: "ConfidentialGovToken",
        args: () => ["Confidential USDT (Mock)", "cUSDT", INITIAL_SUPPLY],
        administrator: "deployer",
        externalAddress,
      },
      {
        name: "MockPriceOracle",
        artifactName: "MockPriceOracle",
        args: () => [price],
        administrator: "deployer",
      },
      {
        name: "BuybackVault",
        artifactName: "BuybackVault",
        args: (addresses) => [
          addresses.ConfidentialGovToken,
          addresses.ConfidentialUSDT,
          addresses.MockPriceOracle,
          duration,
        ],
        dependencies: ["ConfidentialGovToken", "ConfidentialUSDT", "MockPriceOracle"],
        immutableAddresses: (addresses) => ({
          CTOKEN: addresses.ConfidentialGovToken,
          CUSDT: addresses.ConfidentialUSDT,
          ORACLE: addresses.MockPriceOracle,
        }),
        administrator: "deployer",
      },
    ];
  },
};
