# Confidential Ops Hub

Confidential financial operations for DAO treasury teams, powered by [Zama FHEVM](https://docs.zama.org/protocol). The hub brings independent feature contracts into one frontend, starting with the existing buybacks prototype.

**Network:** Sepolia · **Status:** PoC, not audited or production-ready

![Confidential Ops Hub workspace chooser](docs/hub.png)

## Operations

| Feature                               | App status               | Development priority | Decision record                               |
| ------------------------------------- | ------------------------ | -------------------- | --------------------------------------------- |
| [Buybacks](docs/features/buybacks.md) | Available in both workspaces | Implemented          | [ADR-0002](docs/adr/0002-buybacks.md)         |
| [Payroll](docs/features/payroll.md) | Demo frontend in both workspaces | Live integration pending | [ADR-0003](docs/adr/0003-payroll.md) |
| Payment Requests                      | Soon                     | Todo                 | [ADR-0004](docs/adr/0004-payment-requests.md) |
| Token Launchpad                       | Soon                     | Backlog              | [ADR-0005](docs/adr/0005-token-launchpad.md)  |
| [Vesting](docs/features/vesting.md) | Soon | Contracts implemented | [ADR-0006](docs/adr/0006-vesting.md) |
| Governance                            | Soon                     | Todo                 | [ADR-0007](docs/adr/0007-governance.md)       |
| Airdrop / Staking                     | Soon                     | Backlog              | [ADR-0008](docs/adr/0008-airdrop-staking.md)  |

The homepage offers Community and DAO dashboard workspaces. The header switches between them; the left menu lists their features. Community lists buybacks and opens the seller's offer and claim tools. The DAO dashboard opens the current DAO's tools to create and manage buybacks. Both link to one public buyback report. All pages are public; wallet permissions control actions and private decryption. See [ADR-0010](docs/adr/0010-community-dao-workspaces.md) for the selected layout and access boundaries.

Payroll has a mock frontend demo at `/dao/payroll` and `/community/payroll`. The DAO screen simulates a sender flow, and the Community screen shows only the demo receiver's own payments after mock signing. It has no wallet, RPC, signature, transaction, or saved salary data. The caller-funded confidential multisend contract, local tests, and source-verified Sepolia deployment remain separate from this demo; live payment checks and frontend integration are pending. Vesting has a shared confidential grant contract, deployment tooling, and local tests; live deployment and frontend work remain pending. The other future operations have Soon pages in both workspaces, and their ADRs remain proposed.

## Architecture

```text
Confidential Ops Hub frontend
├── Shared layout, wallet connection, encryption and transaction utilities
├── Buybacks feature → existing BuybackVault + token/oracle dependencies
└── Future features → independent contracts
```

Features own their contract interfaces, deployment configuration, and business logic. Private decryption sessions are scoped to a wallet, chain, and explicit feature contract set; changing scope or wallet replaces private state. The shared FHE helper has no buyback-address dependency.

Each feature defines its own privacy policy. Buybacks encrypts amounts and seller price floors while participation metadata stays public, and supports delayed public disclosure of aggregate totals. That disclosure policy is not automatically applied to payroll or other features.

The current frontend uses one configured Sepolia buyback deployment. Vesting has feature-local shared custody. DAO onboarding, live deployment discovery, and organization-wide permissions remain future work. See [ADR-0001](docs/adr/0001-independent-feature-contracts.md).

## Repository

```text
frontend/src/
  app/                      # Chooser, Community, DAO dashboard, shared public report
  components/               # Shared shell, wallet button, encrypted values
  features/buybacks/        # Buyback panels, epoch reads, addresses and ABIs
  features/payroll/         # Mock payroll demo, exact-unit model, and private-state guard
  lib/                      # Wallet, FHE, decryption, transaction utilities
contracts/
  src/buybacks/              # BuybackVault and oracle interface
  src/payroll/               # Caller-funded confidential multisend
  src/vesting/               # Shared confidential grants
  src/mocks/                 # Demo tokens and price oracle
  test/mocks/                # Shared test-only confidential token
  test/buybacks/             # Existing contract regression suite
  test/payroll/              # Multisend payment and privacy tests
  deploy/buybacks.ts         # Guarded buyback deployment wrapper
  deploy/payroll.ts          # Guarded multisend deployment wrapper
  deploy/vesting.ts          # Guarded immutable vesting deployment wrapper
  test/vesting/              # Grant lifecycle and privacy tests
  abi/vesting/               # Generated vesting interface
  scripts/buybacks/          # Seed and state-verification scripts
  scripts/deployment/        # Shared guarded feature deployment helpers
  scripts/payroll/           # Payroll deployment config, wrappers, and live evidence
  scripts/vesting/           # Vesting deployment config, wrappers, and ABI export
CONTEXT.md                   # Domain glossary
docs/adr/                    # Accepted and proposed architectural decisions
docs/deployment.md           # Shared feature deployment guide
docs/features/               # Feature behavior and operational details
docs/agents/                 # Linear, triage, and domain-doc skill conventions
```

## Development

Use Node **22.13 or newer** (Node 22 LTS recommended), npm, and an injected wallet on Sepolia for transaction flows. The frontend's unit tests use Node's TypeScript stripping support.

From the repository root:

```bash
cd contracts
npm ci
npm run compile
npm test

cd ../frontend
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Visit `http://localhost:3000` to choose a workspace. No wallet is needed to browse.

| Route | Page |
| --- | --- |
| `/community/buybacks` | Buyback list |
| `/community/buybacks/ctoken` | Sell and claim |
| `/dao` | Current DAO overview |
| `/dao/buybacks` | Buyback treasury |
| `/buybacks/report` | Shared public buyback report |
| `/dao/payroll` | Mock DAO payroll sender demo |
| `/community/payroll` | Mock community payroll receiver demo |
| `/community/vesting` | Wallet activity, Soon |
| `/dao/vesting` | DAO operations, Soon |
| `/{community,dao}/payment-requests` | Payment Requests, Soon |
| `/{community,dao}/token-launchpad` | Token Launchpad, Soon |
| `/{community,dao}/governance` | Governance, Soon |
| `/{community,dao}/airdrop-staking` | Airdrop / Staking, Soon |

`/community` and the old `/buybacks` URL redirect to the buyback list. Previous payroll-only URLs are removed. The current deployment uses the display name `cTOKEN DAO`; there is no DAO onboarding or selector. Leaving a private buyback page clears its decryption session and plaintext.

The buyback configuration lives in `frontend/src/features/buybacks/contracts.ts`. Existing addresses and ABI behavior are preserved. See the [buybacks guide](docs/features/buybacks.md) for recorded addresses, privacy details, known limitations, and the two-wallet demo flow.

## Buyback deployment

Buybacks uses the shared guarded deployment engine. From `contracts/`, configure `PRIVATE_KEY`, `RPC_URL`, and `EXPECTED_DEPLOYER_ADDRESS` locally. `CUSDT_ADDRESS`, `ORACLE_PRICE`, and `EPOCH_DURATION` are optional configuration overrides. Follow the [deployment guide](docs/deployment.md) for the approval cycle, `BUYBACKS_DEPLOY_*` gas variables, and external cUSDT checks.

```bash
npm run preflight:buybacks:sepolia
npm run deploy:buybacks:sepolia
npm run verify:buybacks:sepolia
```

Sepolia deploys one pending buyback contract for each approved preflight. Repeat preflight and deployment until the graph completes, then run verification. The existing `deploy:sepolia` and `deploy:localhost` aliases remain buyback-only and use the same guards.

Seeding is a separate treasury action for the default mock payment token only. It funds the vault and opens a demo epoch. Approve that funding separately from contract deployment. When using an external `CUSDT_ADDRESS`, do not run the seed script; fund and initialize the vault through the token's supported flow.

## Feature deployment

Buybacks, payroll, and vesting use shared guarded deployment helpers. Their feature-specific commands, environment variables, and operational limits are in the [deployment guide](docs/deployment.md). Payroll is deployed on Sepolia, but its available frontend is a mock demo only; live payment integration remains pending. Vesting is not deployed and remains Soon in the app.

Buyback seeding and private state verification remain feature-only operations. The existing `deploy:sepolia` and `deploy:localhost` npm commands remain buyback-only, with the same guarded deployment flow. The [buybacks guide](docs/features/buybacks.md), [payroll guide](docs/features/payroll.md#sepolia-deployment), and [vesting guide](docs/features/vesting.md#later-sepolia-deployment) give feature-specific steps.

## Extending the hub

Add frontend behavior under `frontend/src/features/<feature>/` with a route in `app/`. Keep contract sources, tests, and deployment scripts grouped by feature. Reuse the shared providers and utilities, and supply an explicit `DecryptionProvider` scope for private reads. Use mocks only for development/demo dependencies.

Before implementation, resolve the feature's ADR, including authorization, funding/settlement, and privacy. Define who may decrypt each value and whether anything is publicly disclosed. Record domain terms in [CONTEXT.md](CONTEXT.md). Follow the contracts, deploy, design, and frontend implementation stages in [ADR-0009](docs/adr/0009-feature-delivery-stages.md).

Work is tracked in the configured [Linear project and milestone](https://linear.app/bleu-builders/project/web3-deals-a5e6ddb5d475/overview#milestone-6ef4fdcd-b796-4111-b482-9485d74579b2). [Agent conventions](docs/agents/issue-tracker.md) describe the workflow; configuration alone does not create Linear issues or labels.
