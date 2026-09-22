---
status: accepted
---

# Plan new features in four delivery stages

Each new feature follows a plan with four ordered stages: contracts, deploy, design, and frontend implementation. Resolve the feature's behavior, authorization, asset handling, and disclosure policy in its ADR before starting. Keep feature boundaries from [ADR 0001](0001-independent-feature-contracts.md). This order lets design use a tested contract interface and a verified deployment, at the cost of delaying detailed UI work until those are ready.

## Contracts

Implement the feature's contracts and focused unit tests. Define public metadata, encrypted values, and authorized readers. Test actual confidential transfer outcomes, accounting, authorization, and failure paths. Run the existing buyback tests to check for regressions. The stage is complete when the feature tests and existing tests pass and the contract interface is ready for deployment.

## Deploy

Add feature-owned deployment scripts and configuration, then deploy to Sepolia through an explicit operator action. Record contract addresses, ABIs, dependencies, and commands needed to verify the deployment. Check the main transaction flows and decryption permissions on the deployed contracts. Local mock tests alone do not complete this stage.

## Design

Design the treasury and recipient flows that the feature needs against the verified contract interface. Cover wallet and network states, transaction progress, private decryption, empty states, and failures. Distinguish transaction confirmation from verified payment or funding results. Preserve the hub's dark theme and yellow accents. Complete the stage with agreed screens, actions, and acceptance criteria for frontend implementation.

## Frontend implementation

Build the agreed design under the feature's own frontend directory and route. Use its deployment configuration and explicit private-decryption scope. Clear plaintext and invalidate pending private reads when the wallet, chain, or scope changes. Run frontend lint, private-decryption tests, and a production build. Verify the integrated flows on Sepolia before removing the feature's Soon label.

Track the stages and their acceptance criteria in the configured issue tracker. Keep accepted decisions in ADRs and operational instructions in feature docs. If deployment or design exposes a contract gap, update the affected decision and repeat the required contract tests and deployment checks before continuing.
