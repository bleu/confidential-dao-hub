# Confidential Ops Hub contracts

One Hardhat project containing independent feature contracts. Buybacks is currently the only implemented feature; future
contracts are not scaffolded with empty implementations.

- `contracts/buybacks/`: existing `BuybackVault` and its `IPriceOracle` interface.
- `contracts/mocks/`: mintable demo confidential token and owner-set price oracle.
- `test/buybacks/`: FHEVM mock regression tests.
- `deploy/buybacks.ts`: existing deployment names, tag, and identifier preserved.
- `scripts/buybacks/`: demo funding/initialization and state verification.

See the [root README](../README.md) for commands and the [buybacks guide](../docs/features/buybacks.md) for behavior,
recorded deployments, and known limitations. Run `npm ci`, `npm run compile`, and `npm test` from this directory.

Future features should define their own custody and permissions. Mock assets and the buyback disclosure policy are not
defaults for production features.
