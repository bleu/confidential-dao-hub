# Feature deployment

Payroll and vesting use the guarded feature deployment helpers in `contracts/scripts/deployment/`. Buybacks keeps its own deployment and verification flow. The generic `deploy:sepolia` and `deploy:localhost` npm commands are tagged for buybacks only.

## Feature configuration

Each supported feature has a typed `DeploymentFeature` configuration in `contracts/scripts/<feature>/deployment.ts`. It defines `key`, `contractName`, `deploymentId`, and `envPrefix`. A feature can also provide `inspectConfiguration(provider)` to collect public configuration metadata, such as token code metadata for payroll.

The shared helpers derive ABI and deployment-record output names from `key` and `contractName`. For example, payroll exports `deployment-records/payroll/sepolia/ConfidentialMultisend.abi.json`. Do not add deployment-wide fields for a dependency that belongs only to one feature. Payroll requires its demo token code check through `inspectConfiguration`; vesting has no such check.

The helpers deploy contracts without constructor arguments, linked libraries, or immutable references. A feature that needs any of those must use a different deployment design. The helpers fail explicitly instead of silently producing an incomplete deployment.

## Add a feature

Add one configuration and three thin wrappers. The preflight and verification wrappers convert unknown errors with `safeCommandError(error)` and set a failing exit code. They do not implement deployment logic.

The configuration imports `DeploymentFeature` from the shared deployment types. The command wrappers import `hre` from `hardhat`, their command function from `../deployment/commands`, and `safeCommandError` from `../deployment/errors`.

```ts
// scripts/example/deployment.ts
import type { DeploymentFeature } from "../deployment/feature";

export const exampleFeature: DeploymentFeature = {
  key: "example",
  contractName: "Example",
  deploymentId: "deploy_example_v1",
  envPrefix: "EXAMPLE",
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

The shared exports are `runPreflightCommand(hre, feature)`, `runVerifyCommand(hre, feature)`, and `createFeatureDeployment(feature)`. Keep the existing deployment tag and deployment ID when converting a feature. Add aliases that select that feature's tag:

```json
{
  "preflight:example:sepolia": "hardhat run scripts/example/preflight.ts --network sepolia",
  "deploy:example:sepolia": "hardhat deploy --tags Example --network sepolia",
  "verify:example:sepolia": "hardhat run scripts/example/verify-deployment.ts --network sepolia"
}
```

## Sepolia procedure

Set `PRIVATE_KEY`, `RPC_URL`, and `EXPECTED_DEPLOYER_ADDRESS` locally. The expected address is shared by all guarded feature deployments. Set `<PREFIX>_DEPLOY_GAS_LIMIT` and `<PREFIX>_DEPLOY_MAX_FEE_PER_GAS_WEI` after reviewing the preflight output. Their product is the approved maximum gas cost.

Run the feature preflight. It checks the chain, signer, artifact, pending nonce, and gas caps. It produces `<PREFIX>_DEPLOY_CONFIRMATION`, which binds those values. Supply that confirmation only for the approved deployment command. Do not store it in shared configuration.

Run the feature verifier after the deployment confirms. It checks the receipt and runtime bytecode, then exports the ABI and public deployment record. Source verification is a separate explorer action. A failed preflight, deployment, verifier, or explorer request must not trigger another deployment or overwrite an existing public record. Check the existing transaction and record before any retry.

## Payroll history

The public payroll deployment record and ABI keep their original provenance. Its recorded source name is `contracts/payroll/ConfidentialMultisend.sol`, while the current repository source is `src/payroll/ConfidentialMultisend.sol`. Use the current `src/payroll/ConfidentialMultisend.sol:ConfidentialMultisend` fully qualified name for new operational commands.

Compiling the current source does not prove the historical build. To verify the historical deployment build, use the original source, compiler settings, and other recorded build inputs. Do not redeploy or replace the historical ABI or record when that proof is unavailable.
