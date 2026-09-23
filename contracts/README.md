# Confidential Ops Hub contracts

One Hardhat project containing independent feature contracts. Buybacks has a configured Sepolia deployment. Payroll has a caller-funded confidential multisend contract and local tests; deployment remains pending. Other future contracts are not scaffolded with empty implementations.

- `contracts/buybacks/`: existing `BuybackVault` and its `IPriceOracle` interface.
- `contracts/payroll/`: permissionless `ConfidentialMultisend` with caller-funded ERC-7984 payments.
- `contracts/mocks/`: mintable demo confidential token, owner-set price oracle, and test tokens.
- `test/buybacks/`: FHEVM mock regression tests.
- `test/payroll/`: multisend payment, failure, privacy, and encrypted-computation limit tests.
- `deploy/buybacks.ts`: existing deployment names, tag, and identifier preserved.
- `scripts/buybacks/`: demo funding/initialization and state verification.

See the [root README](../README.md) for setup, the [buybacks guide](../docs/features/buybacks.md) for the existing deployment, and the [payroll guide](../docs/features/payroll.md) for the multisend interface and token requirements. Run `npm ci`, `npm run compile`, and `npm test` from this directory. Use `npm test -- --grep "ConfidentialMultisend"` for payroll tests only.

All buyback, payroll, and vesting tests use `GenericConfidentialToken`. It inherits the demo token and adds unrestricted controls for zero transfers, reverted transfers, and callbacks. These controls are off by default. Use it only in local tests. Demo deployments continue to use `ConfidentialGovToken`.

Features define their own custody and permissions. Mock assets and the buyback disclosure policy are not defaults for production features.
