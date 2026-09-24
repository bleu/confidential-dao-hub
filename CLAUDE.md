# Confidential Ops Hub

A PoC for confidential DAO treasury operations on Zama FHEVM. Buybacks is implemented. Payroll has wallet-backed DAO and Community flows for caller-funded confidential multisend payments on Sepolia. It has no administrator, employee roster, saved salary data, advance funding, managed payroll balance, or duplicate-payment protection. Vesting has UI-only DAO and Community routes backed by preview data; wallet, contract, decryption, indexer, and transaction integration remain pending. The other operations are future features displayed as Soon. Read the root README for setup and repository navigation.

## Architecture

- Features own independent contracts, frontend business logic, ABIs, and deployment configuration. Share wallet, encryption, and presentation utilities where their behavior is feature-independent.
- The frontend is a Next.js App Router app using Tailwind, wagmi/viem, and the Zama relayer SDK. Preserve the dark theme and yellow accents.
- Private reads belong to a feature's `DecryptionProvider`. Specify its contract scope; isolate sessions and decrypted values when the wallet, chain, or scope changes. Pending results must not restore cleared plaintext.
- The Hardhat project groups contracts and tests by feature. Mocks are demo dependencies. Preserve existing deployment identifiers and addresses when reorganizing source files.
- Future-feature ADRs are proposed, not implemented specifications. Resolve authorization, asset handling, and privacy before building a feature. Each feature defines its own disclosure policy.

## Buybacks

Before changing buyback behavior, read `docs/features/buybacks.md` and `docs/adr/0002-buybacks.md`. The implementation uses rolling epochs, oracle price snapshots, confidential price floors, and proof-based aggregate disclosure. Its existing funding and reporting limitations are documented there.

When changing FHE contract logic, check the installed versions and current official Zama/OpenZeppelin APIs. Match the existing `FHE.*` and ERC-7984 patterns, grant the required ciphertext permissions, and use encrypted selection rather than branching on secrets. Account for actual confidential transfer outcomes.

## Verification

Run the existing buyback tests after contract changes or source reorganization. Run frontend lint, private-decryption tests, and a production build after frontend changes. Add focused regression tests when changing authorization or private-state handling. Update documentation links and operational commands when moving files.

## Agent skills

### Issue tracker

Track work in the configured Linear project and milestone. Before reading or publishing tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. Before triaging tickets, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single root glossary and ADR directory. Before exploring domain behavior or proposing architecture changes, read `docs/agents/domain.md`.
