# Confidential payroll multisend

Payroll uses a permissionless multisend to pay several recipients with one confidential token. Each call spends the caller's funds. There is no administrator, employee roster, saved salary, advance deposit, or managed payroll balance. See [ADR 0003](../adr/0003-payroll.md) for the design decision.

Payroll is deployed on Sepolia with verified source code. Live payment checks and frontend integration are still pending, so payroll remains Soon in the app. Follow the [feature delivery stages](../adr/0009-feature-delivery-stages.md) before making it available.

## Contract interface

Source: `contracts/src/payroll/ConfidentialMultisend.sol`.

```solidity
function multisend(
    address token,
    address[] calldata recipients,
    externalEuint64[] calldata encryptedAmounts,
    bytes calldata inputProof
) external;

event Payment(
    address indexed sender,
    address indexed token,
    address indexed recipient,
    euint64 requestedAmount,
    euint64 actualAmount
);
```

The encrypted amount types are `bytes32` in the ABI. After compilation, the full ABI is in `contracts/artifacts/src/payroll/ConfidentialMultisend.sol/ConfidentialMultisend.json`. Generated artifacts are not checked in.

Public validation uses `InvalidBatchSize(uint256)`, `MismatchedArrays()`, and `InvalidRecipient(address)`. Reentry fails with `ReentrancyGuardReentrantCall()`. FHE input errors and token errors propagate unchanged.

Each call takes one token and 1-10 payment entries. The recipient and amount arrays must have the same length. Zero amounts and repeated recipient addresses are valid; each entry produces its own payment log. Zero-address recipients and the multisend itself are rejected. Amounts are unsigned 64-bit token units. The multisend neither assumes token decimals nor clamps values.

## Sender flow

1. Check that the token meets the requirements below. Confirm its address, unit scale, recipients, and amounts.
2. Call the token's `setOperator(multisendAddress, until)` from the paying wallet. The multisend must remain an authorized operator when the payment transaction executes.
3. Encrypt the amounts for the multisend contract address and the paying wallet address. Pass the resulting handles and shared input proof to `multisend`.
4. Read the transaction's `Payment` logs. Decrypt the actual amounts before treating a payment as complete.
5. Remove or shorten the token operator permission when it is no longer needed, using the token's permission API.

Operator permission is time-limited, not amount-limited. It allows the operator to transfer funds from the holder while the permission is active. The multisend limits each call's funding source to `msg.sender`; a caller cannot choose another holder's balance. The standard token treats the operator as valid at the exact expiry timestamp and expired after that timestamp.

Every new transaction is a new payment request. Sending the same inputs again can pay again. The contract has no request IDs, duplicate protection, saved unpaid amounts, or retry accounting. A future frontend must review inputs and prevent accidental duplicate clicks.

## Payment outcomes

The contract computes the encrypted total with overflow checks and pulls the total before making payments. Outgoing amounts depend on whether this call pulled the full total. A balance already held by the multisend cannot make a failed pull count as funded.

For a supported standard token:

- A funded batch pays every requested amount.
- Insufficient caller funds produce zero for every payment.
- An encrypted total above `2^64 - 1` produces zero for every payment without pulling caller funds.
- A requested zero amount is valid. Compare actual and requested amounts, rather than using a positive amount as the only success test.

An encrypted insufficient-balance result cannot trigger a synchronous Solidity revert with these APIs. The transaction can therefore confirm while all payments are zero. No plaintext success flag or total is published.

Invalid public inputs, invalid encrypted inputs, failed operator checks, and token-call reverts fail the transaction. A later transfer revert rolls back the initial pull, earlier payments, and logs. The contract does not catch errors to continue a batch. A reentrancy guard protects token-call boundaries.

## Supported tokens and stuck funds

The caller selects an ERC-7984 token on each call. There is no hardcoded asset, token allowlist, or token-specific decimal conversion. Local standard-token tests use separate instances of `GenericConfidentialToken` with its test controls disabled. It inherits the OpenZeppelin ERC-7984 implementation through `ConfidentialGovToken`.

The all-or-zero guarantee requires standard token behavior: a transfer moves the full requested amount or zero on insufficient balance, reports its actual amount, and preserves standard balance and supply accounting. The token must not add fees, partial transfers, or encrypted restrictions that can reject an otherwise funded outgoing payment. An ERC-7984-shaped interface alone does not prove these properties.

For example, a custom token could pull only part of the total. The multisend would send zero to every recipient because the pull did not match the total, but that partial pull could remain stuck. A token could also accept the pull and return encrypted zero for a later recipient, leaving a mixed result without a Solidity revert. Such behavior is outside the guarantee. A caller must verify the token implementation before use.

Do not send tokens directly to the multisend. There is no recovery or withdrawal function. Accidental deposits can remain stuck, and the contract does not use them to cover another caller's failed or underfunded batch.

## Privacy and discovery

Sender and recipient addresses, the token address, entry count, and transaction timing are public. Requested and actual amounts remain encrypted. The contract does not automatically publish amounts, totals, or payment success.

Use normal transaction logs for discovery. Filter `Payment` by sender, token, or recipient. The transaction hash and log position identify an entry; repeated recipients remain separate payments. There is no separate payroll history store or read index.

For each payment log, the sender and that entry's recipient can decrypt the requested and actual amount references with the multisend contract as the decryption scope. Other recipients and outsiders are not granted access to those references. These permissions do not grant access to another holder's token balance. A sender or recipient who can decrypt a value can still share its plaintext outside the application.

Future frontend decryption must isolate sessions by wallet, chain, and feature contract scope. Clear plaintext and reject pending results when those change, as required by [ADR 0001](../adr/0001-independent-feature-contracts.md).

## Sepolia deployment

The deployed multisend is [`0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91`](https://sepolia.etherscan.io/address/0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91#code), on chain `11155111`. The deployment transaction is [`0x12860fe17db8c9cd7e53c361663e5a1cc210d948afaafa731b61c052b0b8fc1f`](https://sepolia.etherscan.io/tx/0x12860fe17db8c9cd7e53c361663e5a1cc210d948afaafa731b61c052b0b8fc1f), from `0x76b0340e50BD9883D8B2CA5fd9f52439a9e7Cf58`, in block `11765852`. Receipt and exact runtime-bytecode checks passed, and Etherscan source verification succeeded through API V2. No live payment or private-read checks have been run yet.

The [deployment record](../../contracts/deployment-records/payroll/sepolia/deployment.json) includes compiler settings and artifact hashes. The [ABI](../../contracts/deployment-records/payroll/sepolia/ConfidentialMultisend.abi.json) is exported from the compiled artifact. The recorded mock token has a code-presence check only; its live payment compatibility has not yet been verified.

Deploy only `ConfidentialMultisend`. It has no constructor arguments, administrator, or fixed token address. Its preserved tag is `ConfidentialMultisend` and its deployment ID is `deploy_confidential_multisend_v1`. It does not deploy tokens or change buyback contracts. The shared helpers and retry rules are documented in the [deployment guide](../deployment.md). Never use an untagged `hardhat deploy` command for payroll: it can run other features' deployment scripts.

From `contracts/`, put the deployer key in `PRIVATE_KEY` and the Sepolia endpoint in `RPC_URL` in your local `.env`. Do not commit this file or paste its contents into logs or chat. Use a funded Sepolia wallet, not the default local test wallet. Set `ETHERSCAN_API_KEY` in `.env` for source verification. The config also accepts `npx hardhat vars set ETHERSCAN_API_KEY` as a fallback.

The payroll feature configuration uses the shared `EXPECTED_DEPLOYER_ADDRESS` check. It also requires deployed code at the configured demo token address and records its public code hash. This check belongs to payroll; the multisend has no fixed token dependency, and vesting does not run this check.

Run the local checks below before deployment. Set `EXPECTED_DEPLOYER_ADDRESS` to the public wallet address you approved, then run:

```bash
npm run preflight:payroll:sepolia
```

Review the public deployer address and gas estimate. Set `PAYROLL_DEPLOY_GAS_LIMIT` to the approved maximum gas units and `PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI` to the approved maximum wei per gas, then run preflight again. Their product is the maximum deployment gas cost; the deployer must have at least that much ETH. Deployment uses these caps and refuses an estimate that does not fit.

Approve deployment separately. The deploy command requires `PAYROLL_DEPLOY_CONFIRMATION` from the capped preflight; it binds the chain, signer, artifact, pending nonce, and gas caps. Do not keep this confirmation in a shared configuration file.

```bash
npm run deploy:payroll:sepolia
npm run verify:payroll:sepolia
npx hardhat verify --network sepolia --contract src/payroll/ConfidentialMultisend.sol:ConfidentialMultisend <multisend-address>
```

The state verifier checks the deployed contract and exports its ABI and deployment record to `contracts/deployment-records/payroll/sepolia/` relative to the repository root. Review these public files before committing them. The last command submits the current source to Etherscan and has no constructor arguments. A source-verification failure can be retried without rerunning deployment.

The published payroll ABI and deployment record remain the public record for the existing Sepolia deployment. That record identifies the historical source as `contracts/payroll/ConfidentialMultisend.sol`; the current source is `src/payroll/ConfidentialMultisend.sol`. Recompiling the current source does not verify the historical build. That proof requires the matching original source, compiler settings, and recorded build inputs. Do not redeploy the multisend or overwrite its ABI or deployment record if historical source verification fails.

Live payment tests have a separate approval step and use dedicated demo wallets. Approval to deploy does not authorize spending a sender's tokens.

The initial demo token is the existing mock cUSDT at `0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA`. Verify its deployed code before use. Reusing this token does not authorize using buyback vault funds or changing buyback configuration. Its faucet accepts a public amount; faucet funding is not confidential.

Deployment verification must check the receipt and runtime bytecode, then export the ABI and public provenance record. Source verification is a separate check; a failed explorer request must not trigger another deployment. Do not claim deployment or payment success until the corresponding checks pass.

Live payment checks must decrypt requested and actual amounts with the sender and recipient wallets. Keep plaintext values out of output and saved evidence. A test summary can reveal whether a demo payment succeeded, so use only approved demo data. Do not automatically repeat a transaction after a timeout: check its receipt first. The contract has no duplicate-payment protection.

`npm run test:sepolia` does not verify the deployed multisend. The payroll unit tests skip outside the local FHE mock. Live checks must run through the live relayer and report their results separately from local tests.

### Live demo setup

The live evidence script uses a separate sender, ten recipient wallets, and an outsider wallet. All twelve wallets must be distinct, must use private test keys, and must differ from the deployer. Never use the public Hardhat test keys on Sepolia. Only the sender needs ETH for these transactions. Its cUSDT balance must start at zero.

Configure these values locally without printing them:

| Variable | Meaning |
| --- | --- |
| `EXPECTED_DEPLOYER_ADDRESS` | Public deployer address, excluded from the demo wallets |
| `PAYROLL_LIVE_MULTISEND_ADDRESS` | Verified deployed multisend |
| `PAYROLL_LIVE_RPC_URL` | Sepolia RPC endpoint |
| `PAYROLL_LIVE_SENDER_PRIVATE_KEY` | Dedicated demo sender key |
| `PAYROLL_LIVE_RECIPIENT_PRIVATE_KEYS` | Ten recipient keys, separated by commas |
| `PAYROLL_LIVE_OUTSIDER_PRIVATE_KEY` | Separate outsider key |
| `PAYROLL_LIVE_PAYMENT_AMOUNT` | Positive token units per entry, within the script's demo limit |
| `PAYROLL_LIVE_OPERATOR_SECONDS` | Permission lifetime, 900-3600 seconds |
| `PAYROLL_LIVE_JOURNAL` | New local journal path in an existing directory |

After reviewing the wallets and transaction sequence, explicitly authorize the demo:

```bash
PAYROLL_LIVE_EVIDENCE=I_AUTHORIZE_SEPOLIA_PAYROLL_DEMO_TRANSACTIONS_WITH_OPERATOR_GRANT_AND_REVOCATION npm run evidence:payroll:sepolia
```

This authorizes an operator grant, an underfunded submission, faucet funding, a funded ten-recipient submission, and operator revocation. The script checks all ten recipients' own private reads and samples outsider and cross-recipient ACL denial for both requested and actual amounts. An ACL denial is a permission check, not a failed live decryption request. Each multisend is a new payment request. The script refuses to reuse an existing journal. After interruption, inspect the saved transaction hashes and on-chain receipts before deciding whether to start a new demo. A lost RPC response does not prove that a transaction failed.

The demo uses equal payment amounts and public faucet funding. Those choices make demo amounts inferable from the test setup. Use throwaway demo data, never real salaries. The private-read checks test who has decryption access; they do not make this demo's funding confidential.

## Local checks

The payroll tests use `GenericConfidentialToken` in its default mode, including separate instances for token isolation. This shared mock is for local tests only; never deploy it with real funds. They cover normal payment behavior, insufficient funds, operator permissions, input validation, overflow, and privacy. Custom-token fault tests are deferred, including forced later-transfer reverts, reentry, partial transfers, restrictions, and reused result handles. The contract protections remain in place; this test scope does not establish compatibility with other token implementations.

Run from `contracts/`:

```bash
npm run compile
npm test -- --grep "ConfidentialMultisend"
npm test
npm run lint
npm run build:ts
REPORT_GAS=1 npm test -- --grep "ten"
```

The ten-entry test measures encrypted-computation use with `fhevm.computeTransactionHCU(receipt)`. The installed local host requires global HCU below `20_000_000` and maximum sequential depth below `5_000_000`. HCU measures encrypted work; EVM gas is a separate limit. The local ten-entry test measured `12_067_120` global HCU, `4_581_032` maximum depth, and about `6.28 million` EVM gas with the generic test token. Gas varies with calldata and test state. These measurements include fresh requested and actual payment references and the reentrancy guard. Local tests do not replace Sepolia verification during the deployment stage.

API baseline: `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin` 0.4.2, and `@openzeppelin/confidential-contracts` 0.5.1. References: [OpenZeppelin ERC-7984](https://docs.openzeppelin.com/confidential-contracts/api/token), [Zama encrypted inputs](https://docs.zama.org/protocol/solidity-guides/smart-contract/inputs), and [Zama HCU limits](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu).
