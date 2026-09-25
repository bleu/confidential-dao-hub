# Vesting

The contract stage of [ADR 0006](../adr/0006-vesting.md) is implemented and tested locally with the FHEVM mock. `ConfidentialVesting` is deployed on Sepolia. The DAO route creates individual configured-token grants, and the DAO and Community routes discover the connected wallet's grant records, show public details, and decrypt private values only for the grant treasury or recipient. Claim, revocation, and refund actions remain pending. This is a PoC, not audited or production-ready.

## DAO grant creation interface

The DAO route provides one individual-grant form. It accepts a recipient, a configured token, allocation, vesting and cliff durations, an optional custom start date, and revocability. It starts immediately with no cliff by default. Duration units are days, weeks, 30-day months, and 365-day years. The connected wallet is shown as the fixed treasury and refund destination. The review step shows the fixed recipient, token, derived schedule, and revocability before the wallet transaction. Terms cannot be edited, reassigned, or topped up after creation.

The current configured token list contains Sepolia cTOKEN and cUSDT, each with six decimals. This UI list is a selection limit only. The contract can still hold and expose grants created directly with other compatible tokens.

The browser checks the public schedule rules before encryption. A backdated start is valid when the end is still in the future. The review explains immediately accrued vesting and whether a future cliff still blocks access. The transaction execution time, rather than the browser preview, controls the final result.

The DAO first authorizes the vesting contract as the selected token's operator. It then encrypts the requested allocation for the vesting contract and connected treasury, submits `createGrant`, reads the new grant from `GrantCreated`, and decrypts the recorded allocation. The UI shows transaction pending, mined awaiting private verification, funded, zero-funded, and retryable private-check error states separately. A failed private check does not mean zero funding and can be retried without another transaction. A confirmed zero-funded record is not an active entitlement; create a new grant to retry funding. Decryption results and pending operations are cleared or ignored when the wallet, chain, or vesting decryption scope changes.

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

Use `GrantCreated` logs from the deployment block for Created by me and Received by me. Query the indexed treasury and recipient values separately, then deduplicate grant IDs. Public detail reads provide the schedule and ciphertext handles; they do not grant decryption access.

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

The ABI is generated at `contracts/abi/vesting/ConfidentialVesting.json` relative to the repository root. Its source artifact is `contracts/artifacts/src/vesting/ConfidentialVesting.sol/ConfidentialVesting.json`. Regenerate it after contract changes. No frontend addresses are configured by this script.

The deployment configuration is `contracts/scripts/vesting/deployment.ts`. It uses the preserved `ConfidentialVesting` tag and `deploy_confidential_vesting_v1` deployment ID. The preflight and deployment wrappers use the shared helpers described in the [deployment guide](../deployment.md). The contract has no constructor arguments, token list, or treasury setting. Existing buyback deployment identifiers and addresses are unchanged.

## Sepolia deployment

`ConfidentialVesting` v1 is deployed at `0xD75E947e4262627E8fbE009585206F461afFA4b1` on Sepolia (chain ID `11155111`) in block `11766387`. Its transaction is `0xd217c01a59c403cf564df4aab6480dd7912ffd03d548670239808fe6b67cee9b`. The frontend starts discovery from this block and uses the ABI and deployment record in `contracts/deployment-records/vesting/sepolia/`. Do not rerun deployment for this immutable v1 contract.

For a new contract version, set `PRIVATE_KEY`, `RPC_URL`, `ETHERSCAN_API_KEY`, and the shared `EXPECTED_DEPLOYER_ADDRESS` locally from `contracts/`. Do not commit or print the private key. Start with preflight:

```bash
npm run preflight:vesting:sepolia
```

Review the public deployer address and gas estimate. Set `VESTING_DEPLOY_GAS_LIMIT` to the approved maximum gas units and `VESTING_DEPLOY_MAX_FEE_PER_GAS_WEI` to the approved maximum wei per gas, then run preflight again. Their product is the maximum deployment gas cost, and the deployer must hold at least that much ETH. Deployment refuses an estimate that exceeds the caps.

The capped preflight produces `VESTING_DEPLOY_CONFIRMATION`. It binds the vesting feature, `ConfidentialVesting`, full creation calldata, dependency configuration hashes, chain, signer, pending nonce, and gas caps. Approve deployment separately, provide the confirmation only for this command, and do not save it in shared configuration. The vesting graph has one contract; after confirmation, a later deploy invocation only verifies and reports the completed deployment without broadcasting.

```bash
npm run deploy:vesting:sepolia
npm run verify:vesting:sepolia
npx hardhat verify --network sepolia --contract src/vesting/ConfidentialVesting.sol:ConfidentialVesting <deployed-address>
```

The shared verifier reads and checks every vesting descriptor, then exports the ABI and deployment record to `contracts/deployment-records/vesting/sepolia/`. Source verification is a separate explorer action with no constructor arguments. A failed preflight, deployment, verifier, or explorer request must not cause another deployment or overwrite an existing record. Inspect the transaction and records before retrying.

Record the deployed address, ABI, dependency versions, and verification results. Check funding, claims, revocation/refund retries, and decryption access on Sepolia before claiming that stage is complete. Do not deploy `GenericConfidentialToken`; it is a local test adapter with unrestricted controls.
