# Feature deployment

Buybacks, payroll, and vesting use the shared guarded deployment engine in `contracts/scripts/deployment/`. Feature-only operations stay outside it: buyback seeding and private state verification remain in `scripts/buybacks/`, and payroll live evidence remains in `scripts/payroll/`.

## Feature configuration

Each feature defines a typed `DeploymentFeature` in `contracts/scripts/<feature>/deployment.ts`. It has `key`, `tag`, `deploymentId`, `envPrefix`, and `contracts(input)`, which returns an ordered list of `DeploymentContract` descriptors. Do not configure a source name; the engine derives output provenance.

A descriptor defines `name`, `artifactName`, and `args(addresses)`, which returns constructor arguments. It can also declare `dependencies`, an `immutableAddresses` callback, `administrator: "deployer"`, and `externalAddress`. List each dependency before the contract that uses it. `externalAddress` identifies a contract that this feature reuses instead of deploying. The shared engine checks external-address syntax and code before it sends any transaction.

The engine supports constructor arguments and checks each configured immutable address slot after deployment. It fails for linked libraries and unsupported immutable layouts. It derives deployment records and ABI output names from the feature and descriptor names. Every `deploy/*.ts` file is a thin `createFeatureDeployment(config)` wrapper.

Buybacks keeps the `ConfidentialBuybacks` tag and `deploy_confidential_buybacks_v2` deployment ID. Its graph deploys `ConfidentialGovToken`, then includes the default `ConfidentialUSDT` mock descriptor unless `CUSDT_ADDRESS` selects an external cUSDT alias, then deploys `MockPriceOracle` and `BuybackVault`. The existing defaults remain an initial supply of 1,000,000 tokens at six decimals, oracle price `200`, and epoch duration `900` seconds unless their environment overrides apply. The vault receives the configured dependency addresses as constructor arguments, and its immutable addresses are checked. Payroll and vesting keep their existing tags, deployment IDs, and output paths. The historical payroll ABI and deployment record remain unchanged.

## Add a feature

Add one configuration and three thin wrappers. The preflight and verification wrappers pass the Hardhat runtime environment to the shared commands and convert unknown errors with `safeCommandError(error)`.

```ts
// scripts/example/deployment.ts
import type { DeploymentFeature } from "../deployment/feature";

export const exampleFeature: DeploymentFeature = {
  key: "example",
  tag: "Example",
  deploymentId: "deploy_example_v1",
  envPrefix: "EXAMPLE",
  contracts: () => [
    {
      name: "Example",
      artifactName: "Example",
      args: () => [],
    },
  ],
};

// scripts/example/preflight.ts
import hre from "hardhat";
import { runPreflightCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { exampleFeature } from "./deployment";

async function main() {
  try {
    await runPreflightCommand(hre, exampleFeature);
  } catch (error) {
    console.error(safeCommandError(error));
    process.exitCode = 1;
  }
}

void main();

// scripts/example/verify-deployment.ts
import hre from "hardhat";
import { runVerifyCommand } from "../deployment/commands";
import { safeCommandError } from "../deployment/errors";
import { exampleFeature } from "./deployment";

async function main() {
  try {
    await runVerifyCommand(hre, exampleFeature);
  } catch (error) {
    console.error(safeCommandError(error));
    process.exitCode = 1;
  }
}

void main();

// deploy/example.ts
import { createFeatureDeployment } from "../scripts/deployment/deploy";
import { exampleFeature } from "../scripts/example/deployment";

export default createFeatureDeployment(exampleFeature);
```

Add aliases that select the feature tag:

```json
{
  "preflight:example:sepolia": "hardhat run scripts/example/preflight.ts --network sepolia",
  "deploy:example:sepolia": "hardhat deploy --tags Example --network sepolia",
  "verify:example:sepolia": "hardhat run scripts/example/verify-deployment.ts --network sepolia"
}
```

## Sepolia procedure

Set `PRIVATE_KEY`, `RPC_URL`, and `EXPECTED_DEPLOYER_ADDRESS` locally. The expected address is shared by all guarded feature deployments. Set `<PREFIX>_DEPLOY_GAS_LIMIT` and `<PREFIX>_DEPLOY_MAX_FEE_PER_GAS_WEI` after reviewing preflight. Their product is the approved maximum gas cost.

A Sepolia preflight selects one pending descriptor. It checks the chain, signer, full creation calldata including constructor arguments, dependency configuration hashes, pending nonce, and gas caps. It produces `<PREFIX>_DEPLOY_CONFIRMATION`, which binds the feature and selected contract to those values.

Run preflight, approve its output, then run deploy. Repeat that sequence with a fresh confirmation for every remaining descriptor. A completed feature logs the completed graph and broadcasts no transaction, so it needs no new confirmation. Existing confirmed descriptors are verified and reused. A mismatch fails and never causes an automatic replacement.

Run the feature verifier after the graph is complete. It reads and verifies every descriptor, then writes an ABI and deployment record for each. Buyback output is under `deployment-records/buybacks/sepolia/<DeploymentName>/`. Payroll and vesting keep their existing output paths. Explorer source verification is a separate action.

A failed preflight, deployment, verifier, or explorer request must not trigger another deployment or overwrite an existing public record. Check the existing transaction and records before any retry. A local tag deployment runs the complete feature graph without the Sepolia approval cycle.

## Feature commands

Use `preflight:buybacks:sepolia`, `deploy:buybacks:sepolia`, and `verify:buybacks:sepolia` for buybacks. Use the matching payroll and vesting aliases for those features. The older `deploy:sepolia` and `deploy:localhost` aliases remain buyback-only and apply the same guards.

The buyback gas variables are `BUYBACKS_DEPLOY_GAS_LIMIT`, `BUYBACKS_DEPLOY_MAX_FEE_PER_GAS_WEI`, and `BUYBACKS_DEPLOY_CONFIRMATION`. Payroll and vesting use the same names with their own prefixes. `CUSDT_ADDRESS` makes buybacks reuse an external payment token; it must pass the external-address checks before the engine creates a new contract.

## Payroll history

The public payroll deployment record and ABI keep their original provenance. Its recorded source name is `contracts/payroll/ConfidentialMultisend.sol`, while the current repository source is `src/payroll/ConfidentialMultisend.sol`. Use the current `src/payroll/ConfidentialMultisend.sol:ConfidentialMultisend` fully qualified name for new operational commands.

Compiling the current source does not prove the historical build. To verify the historical deployment build, use the original source, compiler settings, and other recorded build inputs. Do not redeploy or replace the historical ABI or record when that proof is unavailable.
