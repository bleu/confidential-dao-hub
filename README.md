# ConfidentialBuybacks

**Dark-pool protocol buybacks on [Zama FHEVM](https://docs.zama.org/protocol).** Built for the Zama Developer Program Builder Track. PoC/MVP quality — not audited, not production.

**Live demo:** _(Vercel URL here)_ · **Network:** Sepolia only

## The problem

Protocols doing on-chain buybacks telegraph their orders. The budget, timing, and every fill are public the moment the program starts — so MEV bots front-run the buys, and the market times its exits against the treasury. The treasury systematically overpays for its own token.

## The idea

A dark-pool-style buyback vault where the treasury buys its own token **directly from holders in sealed epochs**. The budget, individual offers, and fills are FHE-encrypted on-chain — nobody (including other sellers) can see how much is being bought or sold. After an epoch closes and a disclosure delay passes, **anyone** can trigger public decryption of the epoch's total: *confidential during execution, accountable afterward*.

## How it works

```
 Treasury                          BuybackVault                        Sellers
    │                                   │                                 │
    │ 1. fund vault with cUSDT          │                                 │
    │──────────────────────────────────▶│                                 │
    │ 2. openEpoch(enc(budget), price)  │                                 │
    │──────────────────────────────────▶│   3. setOperator(vault, 24h)    │
    │                                   │◀────────────────────────────────│
    │                                   │   4. submitOffer(enc(amount))   │
    │                                   │◀────────────────────────────────│
    │                                   │   escrow cTOKEN, compute under FHE:
    │                                   │   fill      = min(offer, remaining)
    │                                   │   remaining = remaining − fill
    │ 5. closeEpoch()                   │   total    += fill              │
    │──────────────────────────────────▶│                                 │
    │                                   │   6. claim(epoch)               │
    │                                   │◀────────────────────────────────│
    │                                   │   pay enc(fill × price) cUSDT   │
    │                                   │   refund enc(offer − fill)      │
    │                                   │                                 │
    │        7. after 5 min: requestDisclosure + finalizeDisclosure       │
    │           (anyone) → plaintext epoch total, KMS-verified            │
```

### The `FHE.min` running-budget pattern

Fills are first-come-first-served against an **encrypted running budget** — the core trick that keeps every offer O(1) FHE operations, with no loops, no sorting, and no encrypted division:

```solidity
euint64 fill = FHE.min(offer, remaining);       // clamp to what's left (encrypted)
remaining    = FHE.sub(remaining, fill);        // can't underflow: fill ≤ remaining
totalFilled  = FHE.add(totalFilled, fill);
```

A seller whose offer exceeds the remaining budget is partially filled; once the budget is exhausted, later offers get zero fill — but **no one can tell which**, because offers, fills, and the budget are all ciphertexts. Failed conditions become no-ops instead of reverts (never branch on encrypted values).

The escrow uses the actual transferred amount returned by ERC-7984's `confidentialTransferFrom`, so an offer backed by insufficient balance escrows 0 and fills 0 — you can't inflate the total with tokens you don't have.

## Privacy model

| Hidden (encrypted) | Public |
|---|---|
| Epoch budget | Reference price per epoch |
| Remaining budget | That an address submitted an offer (tx metadata) |
| Individual offer amounts | Number of offers, epoch open/close timing |
| Individual fills & payouts | Disclosed epoch totals (after delay, by design) |
| Cumulative bought (until disclosure) | Contract addresses, operator approvals |

**Honest caveats:** participation metadata is visible — observers can see *who* interacted with the vault and *when*; only the amounts are hidden. Other limitations: fills are first-come-first-served (no pro-rata), one offer per seller per epoch, no offer cancellation, and treasury solvency is not verified on-chain (if the vault is underfunded, claims transfer 0 cUSDT rather than reverting — ERC-7984 transfers are all-or-nothing and never revert on insufficient balance).

## Contracts (Sepolia)

| Contract | Address |
|---|---|
| `ConfidentialGovToken` (cTOKEN) | [`0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f`](https://sepolia.etherscan.io/address/0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f) |
| `ConfidentialUSDT` mock (cUSDT) | [`0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA`](https://sepolia.etherscan.io/address/0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA) |
| `BuybackVault` | [`0x84b187a0D9Dd071d18Fb89b5c68c320Ca14B96D4`](https://sepolia.etherscan.io/address/0x84b187a0D9Dd071d18Fb89b5c68c320Ca14B96D4) |

Both tokens are ERC-7984 confidential tokens (euint64 amounts, 6 decimals) with an open capped `faucet()` for the demo. The payment token is a self-deployed mock (the official Sepolia cUSDT wrapper requires wrapping an underlying ERC-20; the vault takes the token address as a constructor param, so it can be swapped).

Price is a plaintext integer: **cUSDT base units per cTOKEN base unit** (`price = 2` ⇒ 2 cUSDT per cTOKEN), so `payout = fill × price` needs no FHE division. Budgets are FHE-clamped to 1e15 and price capped at 1000, so the payout can never overflow euint64.

## Repository layout

```
confidential-buybacks/
├── contracts/        # Hardhat project (Zama FHEVM template)
│   ├── contracts/    # ConfidentialGovToken.sol, BuybackVault.sol
│   ├── test/         # 16 tests on the FHEVM mock, incl. full disclosure proof flow
│   ├── deploy/       # hardhat-deploy script
│   └── scripts/      # seed.ts (fund vault + open epoch), verify-state.ts
└── frontend/         # Next.js app (wagmi + viem + Zama relayer SDK)
```

## Setup

Requires Node ≥ 20.

```bash
# Contracts
cd contracts
npm install
npm test                                  # 16 tests on the FHEVM mock

# Deploy to Sepolia (.env: PRIVATE_KEY, RPC_URL; optional CUSDT_ADDRESS)
npx hardhat deploy --network sepolia
npx hardhat run scripts/seed.ts --network sepolia    # fund vault + open demo epoch

# Frontend (contract addresses live in src/config/contracts.ts)
cd ../frontend
npm install
npm run dev
```

Demo flow with two wallets: **Seller** — faucet cTOKEN → approve vault as operator (24 h) → submit encrypted offer. **Treasury** — decrypt remaining/total, close epoch. **Seller** — decrypt fill, claim payout + refund. **Anyone** — after 5 minutes, request + publish the epoch total on the transparency tab.

## Stack

`@fhevm/solidity` 0.11 · `@openzeppelin/confidential-contracts` 0.5 (ERC-7984) · `@fhevm/hardhat-plugin` mock testing · `@zama-fhe/relayer-sdk` 0.4 (client-side encryption, `userDecrypt` with EIP-712, `publicDecrypt` + on-chain `FHE.checkSignatures`) · Next.js 15, wagmi/viem.
