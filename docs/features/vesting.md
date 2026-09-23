# Vesting

The contract stage of [ADR 0006](../adr/0006-vesting.md) is implemented and tested locally with the FHEVM mock. Sepolia deployment, event indexing, and frontend work remain pending. The app stays **Soon**. This is a PoC, not audited or production-ready.

## Contract and custody

`ConfidentialVesting` is one immutable shared contract for many treasuries, recipients, and ERC-7984 tokens. Any wallet can create a grant. That wallet funds the grant and becomes its fixed treasury and refund destination. The deployer has no special rights.

Each grant has its own allocation and paid amounts. Claims and refunds use these amounts, never the pooled token balance. Direct deposits do not create grants or increase allocations. There is no accidental-deposit recovery; those tokens can remain locked.

The contract accepts any compatible Zama ERC-7984 token address without an allowlist. It assumes standard token behavior. Token restrictions still apply, and accepting an address does not certify its code. Hostile token implementations are outside v1. Token calls are guarded against reentrancy.

## Create and inspect a grant

1. The treasury calls the token's `setOperator(vestingAddress, until)` with an expiry after the funding transaction.
2. Encrypt one `uint64` requested amount for the vesting contract address and the treasury wallet. Amounts use the token's base units.
3. Call `createGrant(recipient, token, start, end, cliff, revocable, amount, inputProof)`.
4. Read the grant ID from `GrantCreated`, call `getGrant(grantId)`, and privately decrypt `allocation` as the treasury or recipient.

A mined transaction is not proof of funding. The allocation is the actual received amount. An insufficient balance or token restriction can cause an encrypted-zero transfer and leave a zero-funded grant. Retry funding by creating a new grant. No top-up exists.

Grant IDs start at 1. The recipient, token, treasury, allocation, dates, and revocability cannot change. The recipient cannot be the zero address or the vesting contract itself. Token addresses must contain contract code. The treasury can also be the recipient.

Schedule dates are public Unix timestamps in seconds, stored as `uint48`. The revocation timestamp is `uint256`, so revocation after the latest valid schedule date cannot wrap it. The end must follow the start and be in the future at creation. A backdated start is valid. Set `cliff` to `0` for no cliff; otherwise it must be between start and end, inclusive.

`getGrant` returns:

| Fields | Meaning |
| --- | --- |
| `treasury`, `recipient`, `token` | Fixed parties and asset |
| `start`, `end`, `cliff`, `revocable` | Fixed schedule and revocation choice |
| `revoked`, `revokedAt` | Whether vesting stopped and its execution timestamp |
| `allocation` | Encrypted actual funding |
| `claimed` | Encrypted total actually paid to the recipient |
| `refundEntitlement` | Encrypted unvested allocation fixed on revocation; zero before revocation |
| `refunded` | Encrypted total actually returned to the treasury |

The amount fields are ciphertext handles, including initialized zero amounts. Only the grant treasury and recipient receive decryption rights to them. The contract retains computation rights. Neither party gains access to pooled token balances or other grants. No amount is made publicly decryptable by the vesting contract. Each party can still share plaintext they decrypt.

## Claims and revocation

The recipient calls `claim(grantId)` to withdraw all currently available tokens to their own wallet. Before start or cliff, vested entitlement is zero. At the cliff, accrued entitlement since start becomes available. Between start and end, vesting is linear and rounds down. At or after end, the full allocation is vested, including the remainder. A four-year schedule with a one-year cliff unlocks 25% at the cliff.

Arithmetic widens the allocation to `euint128` before multiplying by elapsed time. A `uint64` allocation times a `uint48` duration fits in that type. Backdated schedules use the claim transaction's execution time.

Only the grant treasury can call `revoke(grantId)`, and only once for a revocable grant. Revocation records its execution time, stops further vesting, and attempts the unvested refund in the same transaction. Before the cliff, the whole allocation is unvested. Previously vested but unclaimed tokens remain claimable indefinitely.

If the initial refund call reverts, the entire revocation reverts and vesting continues. If the call returns encrypted zero, vesting stays stopped and the outstanding refund remains available. The treasury can call `retryRefund(grantId)` to retry only `refundEntitlement - refunded`. A later retry cannot change the stop time. A reverted retry preserves the previous stop and amounts.

All payouts account for actual transferred amounts. A zero or reverted claim does not consume entitlement. Repeated claims and refunds cannot exceed that grant's entitlement. Successful calls emit activity events even if the encrypted amount transferred is zero; the events do not prove payment.

## Discovery and local estimates

`GrantCreated(grantId, treasury, recipient, token)` indexes the grant ID, treasury, and recipient. The token address is in the event data. `GrantClaimed`, `GrantRevoked`, and `GrantRefundRetried` index the grant ID. None includes an amount. There are no on-chain grant ID lists per wallet.

Use an event index for Created by me and Received by me. The indexing server belongs to the frontend discovery task and is not included here. Public detail reads provide the schedule and ciphertext handles; they do not grant decryption access.

After authorized decryption, estimate progress locally using integer arithmetic:

```text
t = revoked ? revokedAt : currentTime
vested = 0                              if t < start or t < cliff
vested = allocation                     if t >= end
vested = allocation * (t - start) / (end - start) otherwise
available = vested - claimed
unvested = allocation - vested
outstandingRefund = refundEntitlement - refunded
```

Use arbitrary-precision integers, such as JavaScript `bigint`, and round division down. Mark live availability as an estimate: execution time determines the claim. Future UI code must clear decrypted values when the wallet, chain, or contract scope changes, and reject pending results for the old scope.

Addresses, token, schedule, and transaction activity remain public. Confidential amounts do not hide those relationships. There is no pause, upgrade, administrator withdrawal, reassignment, delegated vesting operator, or administrator decryption power. A future version requires a new deployment; it cannot upgrade existing grants.

## Local checks and ABI

From `contracts/`, using Node 22.13 or newer:

```bash
npm run compile
npx hardhat test test/vesting/ConfidentialVesting.ts
npm test
npm run lint
npm run build:ts
npx hardhat deploy --tags ConfidentialVesting --network hardhat --write false
npx hardhat run scripts/vesting/export-abi.ts
```

The focused tests cover funding, authorization, private reads, schedule limits, claim and refund failures, token-call reentrancy, and shared-custody isolation. The local lifecycle test runs the feature deployment script, then funds, claims, revokes with a zero refund, retries, and makes the final recipient claim. The full suite includes the existing buyback regressions. Mock tests do not prove live-chain behavior.

The ABI is generated at `contracts/abi/vesting/ConfidentialVesting.json` relative to the repository root. Its source artifact is `contracts/artifacts/contracts/vesting/ConfidentialVesting.sol/ConfidentialVesting.json`. Regenerate it after contract changes. No frontend addresses are configured by this script.

The deployment script is `contracts/deploy/vesting.ts`, with tag `ConfidentialVesting` and ID `deploy_confidential_vesting_v1`. It has no constructor arguments, token list, or treasury setting. Existing buyback deployment identifiers and addresses are unchanged.

## Later Sepolia deployment

No live deployment was made for this contract stage. An operator must explicitly deploy and verify it in the separate deployment task. From `contracts/`, after setting `PRIVATE_KEY` and `RPC_URL`:

```bash
npx hardhat deploy --tags ConfidentialVesting --network sepolia
npx hardhat verify --network sepolia <deployed-address>
```

Record the deployed address, ABI, dependency versions, and verification results. Check funding, claims, revocation/refund retries, and decryption access on Sepolia before claiming that stage is complete. Do not deploy `VestingTestToken`; it is a local test adapter with unrestricted controls.
