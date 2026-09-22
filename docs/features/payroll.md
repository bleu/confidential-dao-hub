# Confidential payroll multisend

Payroll uses a permissionless multisend to pay several recipients with one confidential token. Each call spends the caller's funds. There is no administrator, employee roster, saved salary, advance deposit, or managed payroll balance. See [ADR 0003](../adr/0003-payroll.md) for the design decision.

This guide covers the contract stage. Payroll has no Sepolia deployment or frontend integration yet and remains Soon in the app. Follow the [feature delivery stages](../adr/0009-feature-delivery-stages.md) before making it available.

## Contract interface

Source: `contracts/contracts/payroll/ConfidentialMultisend.sol`.

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

The encrypted amount types are `bytes32` in the ABI. After compilation, the full ABI is in `contracts/artifacts/contracts/payroll/ConfidentialMultisend.sol/ConfidentialMultisend.json`. Generated artifacts are not checked in.

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

The caller selects an ERC-7984 token on each call. There is no hardcoded asset, token allowlist, or token-specific decimal conversion. Local standard-token tests use separate instances of the repository's `ConfidentialGovToken`, which inherits the OpenZeppelin ERC-7984 implementation.

The all-or-zero guarantee requires standard token behavior: a transfer moves the full requested amount or zero on insufficient balance, reports its actual amount, and preserves standard balance and supply accounting. The token must not add fees, partial transfers, or encrypted restrictions that can reject an otherwise funded outgoing payment. An ERC-7984-shaped interface alone does not prove these properties.

For example, a custom token could pull only part of the total. The multisend would send zero to every recipient because the pull did not match the total, but that partial pull could remain stuck. A token could also accept the pull and return encrypted zero for a later recipient, leaving a mixed result without a Solidity revert. Such behavior is outside the guarantee. A caller must verify the token implementation before use.

Do not send tokens directly to the multisend. There is no recovery or withdrawal function. Accidental deposits can remain stuck, and the contract does not use them to cover another caller's failed or underfunded batch.

## Privacy and discovery

Sender and recipient addresses, the token address, entry count, and transaction timing are public. Requested and actual amounts remain encrypted. The contract does not automatically publish amounts, totals, or payment success.

Use normal transaction logs for discovery. Filter `Payment` by sender, token, or recipient. The transaction hash and log position identify an entry; repeated recipients remain separate payments. There is no separate payroll history store or read index.

For each payment log, the sender and that entry's recipient can decrypt the requested and actual amount references with the multisend contract as the decryption scope. Other recipients and outsiders are not granted access to those references. These permissions do not grant access to another holder's token balance. A sender or recipient who can decrypt a value can still share its plaintext outside the application.

Future frontend decryption must isolate sessions by wallet, chain, and feature contract scope. Clear plaintext and reject pending results when those change, as required by [ADR 0001](../adr/0001-independent-feature-contracts.md).

## Local checks

Run from `contracts/`:

```bash
npm run compile
npm test -- --grep "ConfidentialMultisend"
npm test
npm run lint
npm run build:ts
REPORT_GAS=1 npm test -- --grep "ten"
```

The ten-entry test measures encrypted-computation use with `fhevm.computeTransactionHCU(receipt)`. The installed local host requires global HCU below `20_000_000` and maximum sequential depth below `5_000_000`. HCU measures encrypted work; EVM gas is a separate limit. The local ten-entry test measured `12_067_120` global HCU, `4_581_032` maximum depth, and about `6.25 million` EVM gas. Gas varies with calldata and test state. These measurements include fresh requested and actual payment references and the reentrancy guard. Local tests do not replace Sepolia verification during the deployment stage.

API baseline: `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin` 0.4.2, and `@openzeppelin/confidential-contracts` 0.5.1. References: [OpenZeppelin ERC-7984](https://docs.openzeppelin.com/confidential-contracts/api/token), [Zama encrypted inputs](https://docs.zama.org/protocol/solidity-guides/smart-contract/inputs), and [Zama HCU limits](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu).
