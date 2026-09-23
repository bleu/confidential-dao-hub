# Confidential Ops Hub contracts

One Hardhat project contains independent feature contracts. Buybacks has a configured Sepolia deployment. Payroll has a caller-funded confidential multisend, local tests, and a source-verified Sepolia deployment. Vesting has confidential grants, local tests, and guarded deployment tooling, but no Sepolia deployment. Both app entries remain Soon.

- `src/buybacks/`: existing `BuybackVault` and its `IPriceOracle` interface.
- `src/payroll/`: permissionless `ConfidentialMultisend` with caller-funded ERC-7984 payments.
- `src/vesting/`: immutable shared confidential grants.
- `src/mocks/`: mintable demo confidential token and owner-set price oracle.
- `test/mocks/`: shared test-only `GenericConfidentialToken`.
- `test/buybacks/`: FHEVM mock regression tests.
- `test/payroll/`: multisend payment, failure, privacy, and encrypted-computation limit tests.
- `test/vesting/`: grant lifecycle and privacy tests.
- `deploy/buybacks.ts`, `deploy/payroll.ts`, and `deploy/vesting.ts`: thin guarded feature deployment wrappers.
- `scripts/deployment/`: shared preflight, deployment, provenance, export, and error helpers.
- `scripts/buybacks/`, `scripts/payroll/`, and `scripts/vesting/`: feature configuration, thin command wrappers, and feature-only scripts.

The [deployment guide](../docs/deployment.md) defines the shared buyback, payroll, and vesting procedure. The generic `deploy:sepolia` and `deploy:localhost` npm commands remain tagged for buybacks only and use the shared guards. Use `npm ci`, `npm run compile`, and `npm test` from this directory. Use `npm test -- --grep "ConfidentialMultisend"` for payroll tests only.

All buyback, payroll, and vesting tests use `GenericConfidentialToken`. It inherits the demo token and adds unrestricted controls for zero transfers, reverted transfers, and callbacks. These controls are off by default. Use it only in local tests. Demo deployments continue to use `ConfidentialGovToken`.

Features define their own custody and permissions. Mock assets and the buyback disclosure policy are not defaults for production features.
