# ConfidentialBuybacks — Implementation Spec

Confidential protocol buybacks on Zama FHEVM. Built for the Zama Developer Program **Builder Track** (deadline: July 7, 23:59 AoE — scope is deliberately minimal, PoC/MVP quality, NOT production).

## 1. One-liner

Protocols doing on-chain buybacks telegraph their orders: budget, timing, and fills are public, so MEV bots front-run them and markets time against them. ConfidentialBuybacks is a dark-pool-style buyback vault where the treasury buys its own token directly from holders in sealed epochs — budget, offers, and fills stay FHE-encrypted on-chain, with optional delayed public disclosure of epoch totals ("confidential during execution, accountable afterward").

## 2. Design summary

**Actors:** Treasury (admin/owner) and Sellers (token holders).

**Tokens (both ERC-7984 confidential tokens):**
- `cTOKEN` — mock confidential governance token we deploy (mintable by owner, faucet-style mint for demo).
- `cUSDT` — payment leg. Use the official Zama testnet cUSDT from the Confidential Token Registry on Sepolia (look up the current address in Zama docs; make it a constructor param, do not hardcode).

**Epoch lifecycle:**
1. `openEpoch(encryptedBudget, price)` — Treasury opens an epoch with an **encrypted budget in TOKEN units** (euint64) and a **public plaintext price** `price` (cUSDT per TOKEN, 6-decimals fixed point). Treasury escrows cUSDT into the vault beforehand via confidential transfer (best-effort; see insolvency note in §5).
2. `submitOffer(encryptedAmount, inputProof)` — Seller escrows cTOKEN via `confidentialTransferFrom` (seller must `setOperator(vault, expiry)` on cTOKEN first). Contract computes under FHE:
   ```
   fill      = FHE.min(offer, remainingBudget)
   remaining = FHE.sub(remainingBudget, fill)
   totalFilled = FHE.add(totalFilled, fill)
   ```
   Store encrypted `offer` and `fill` per (epoch, seller). One offer per seller per epoch (simplification — revert on second submit using a plaintext bool flag).
3. `closeEpoch()` — Treasury closes; no FHE work needed at close.
4. `claim(epochId)` — Seller claims: payout = `FHE.mul(fill, price)` scaled correctly, transferred in cUSDT; refund = `FHE.sub(offer, fill)`, transferred back in cTOKEN. Per-seller claims — **never loop over sellers**.
5. `requestDisclosure(epochId)` — after `epoch.closedAt + DISCLOSURE_DELAY` (e.g. 5 minutes for demo), anyone can request **public decryption** of `totalFilled` for that epoch via the decryption oracle; callback stores the plaintext total. This is the transparency feature — implement it, it's a key differentiator.

**Fill policy:** first-come-first-served via the encrypted running budget. This is intentional: it is O(1) FHE ops per offer, needs no loops, no sorting, no encrypted division. Do NOT attempt pro-rata.

## 3. Privacy model (put verbatim in README)

| Hidden (encrypted) | Public |
|---|---|
| Epoch budget | Reference price per epoch |
| Remaining budget | That an address submitted an offer (tx metadata) |
| Individual offer amounts | Number of offers, epoch open/close timing |
| Individual fills & payouts | Disclosed epoch totals (after delay, by design) |
| Cumulative bought (until disclosure) | Contract addresses, operator approvals |

Be honest in the README: participation metadata is visible; only amounts are hidden.

## 4. Repository layout

Monorepo, based on Zama's official Hardhat template (`zama-ai` fhevm hardhat template):

```
confidential-buybacks/
├── contracts/                # Hardhat project
│   ├── contracts/
│   │   ├── ConfidentialGovToken.sol
│   │   └── BuybackVault.sol
│   ├── test/
│   ├── deploy/ (or scripts/)
│   └── hardhat.config.ts
├── frontend/                 # Next.js app
└── README.md
```

## 5. Contracts

**IMPORTANT — check current APIs first.** The FHEVM API surface has churned across versions. Before writing any Solidity, consult the current docs and mirror the official examples:
- https://docs.zama.org/protocol/solidity-guides (quick start, ACL guide, decryption/oracle guide, HCU limits)
- https://github.com/zama-ai/fhevm (examples)
- https://docs.openzeppelin.com/confidential-contracts (ERC7984, operators, transfer variants)
- Zama Hardhat template for config, plugin, and mock testing setup.
Do NOT use stale patterns from training memory (`TFHE.*`, old `Gateway.requestDecryption` signatures, `einput`). Current stack uses `@fhevm/solidity` (`FHE.*`, `externalEuint64`, `FHE.fromExternal`), `ZamaConfig` inheritance (e.g. `ZamaEthereumConfig` / Sepolia config per docs), and `@openzeppelin/confidential-contracts` ERC7984. Match whatever the template and docs show today, exactly.

### 5.1 ConfidentialGovToken.sol
- ERC7984 + Ownable. Constructor mints initial supply to owner.
- Add an open `faucet(uint64 amount)` (plaintext amount, capped, e.g. ≤ 10,000e6) that mints to `msg.sender` so demo users can get cTOKEN easily. PoC-only; note it in comments.

### 5.2 BuybackVault.sol
State (per epoch struct): `euint64 budget`, `euint64 remaining`, `euint64 totalFilled`, `uint64 price` (plaintext, 6dp), `uint64 openedAt/closedAt`, `bool open`, `bool disclosed`, `uint64 disclosedTotal`. Per (epoch, seller): `euint64 offer`, `euint64 fill`, `bool submitted`, `bool claimed`.

Functions:
- `openEpoch(externalEuint64 budgetExt, bytes proof, uint64 price)` — onlyOwner, only one open epoch at a time.
- `submitOffer(externalEuint64 amountExt, bytes proof)` — epoch must be open; pull cTOKEN escrow with `confidentialTransferFrom`. NOTE: ERC7984 transfers move `min(amount, balance)` and do not revert on insufficient balance — use the **transferred amount returned/observed handle** as the effective offer if the API exposes it (check OZ docs for the transfer variant that returns the actual transferred euint64); otherwise document the limitation.
- `closeEpoch()` — onlyOwner.
- `claim(uint256 epochId)` — computes payout/refund, transfers via `confidentialTransfer`, marks claimed. Payout math: amounts and price both 6dp ⇒ `payout = fill * price / 1e6`. FHE has no cheap division by 1e6 — instead define `price` as an integer number of **micro-cUSDT per whole-ish TOKEN unit** chosen so payout = `FHE.mul(fill, priceScaled)` needs no division. Simplest: demo with price expressed as plain multiplier (e.g. price = 2 means 2 cUSDT-units per TOKEN-unit) and document the scaling. Keep it simple; correctness of scaling > realism.
- `requestDisclosure(uint256 epochId)` + oracle callback — public decryption of `totalFilled` per current decryption-oracle docs. Guard: epoch closed, delay elapsed, not yet disclosed.
- View helpers returning ciphertext handles for the frontend (`getMyOffer/getMyFill(epochId)`, `getEpoch(epochId)`).

### 5.3 FHE rules (non-negotiable)
1. **Never `require`/branch on encrypted values.** Use `FHE.select` so failed conditions become no-ops. Plaintext guards (epoch open, already submitted, already claimed) use normal `require`.
2. **ACL discipline:** after every FHE op producing a stored ciphertext, call `FHE.allowThis(x)`. For seller-visible values (`offer`, `fill`), also `FHE.allow(x, seller)`. For treasury-visible values (`budget`, `remaining`, `totalFilled`), also `FHE.allow(x, owner())`. Missing ACL grants are the #1 bug source.
3. **euint64 everywhere.** 6-decimal amounts. Cap offers/budget (e.g. ≤ 1e15) so `fill * price` cannot overflow 64 bits; enforce caps with `FHE.select`-clamping or plaintext caps on faucet/price.
4. Encrypted inputs arrive as `externalEuint64 + inputProof` → `FHE.fromExternal`.
5. Overflow behavior of FHE.add/sub is wrapping — structure math so underflow is impossible (`fill ≤ remaining` by construction via `FHE.min`).
6. Respect HCU limits: O(1) FHE ops per external call; no loops over encrypted arrays.

## 6. Tests (Hardhat + fhevm mock from the template)

Cover at minimum:
- open → single offer smaller than budget → fill == offer, remaining decremented.
- offer larger than remaining → fill == remaining, refund correct.
- two sellers, second partially filled; third gets zero fill.
- claim pays correct cUSDT and refunds correct cTOKEN; double-claim reverts.
- disclosure flow returns correct plaintext total (mock oracle).
- non-owner cannot open/close; offer after close reverts.

## 7. Frontend (Next.js, App Router, TypeScript)

Stack: wagmi + viem, `@zama-fhe/relayer-sdk` (follow current Relayer SDK setup docs — SDK init, encrypted input creation, userDecrypt with EIP-712 signature, publicDecrypt), RainbowKit or plain injected connector. Deploy on Vercel. Network: Sepolia only.

Pages/panels (single-page app with tabs is fine):
1. **Treasury** (visible to all, actions owner-gated): open epoch (budget input → encrypted client-side; price input), close epoch, decrypt-and-view remaining budget + totalFilled (userDecrypt as owner).
2. **Sell** (seller): faucet button for cTOKEN; `setOperator` button (24h expiry) with clear explanation; submit offer (amount encrypted client-side); after close, show *my fill* and *my payout* via userDecrypt; claim button.
3. **Transparency**: list past epochs, price, disclosure status; button to trigger disclosure when eligible; show disclosed totals.

UX requirements:
- Show encrypted values as a lock badge with a "Decrypt" action, never as `0`.
- Cache decrypted values client-side for the session.
- Handle the multi-step flows with clear stepper UI (approve operator → submit; request decrypt → sign → display).
- Read the frontend-design guidance: dark, minimal, "dark pool" aesthetic; distinctive but simple. No template-y look.

## 8. Deployment

- Deploy `ConfidentialGovToken` + `BuybackVault` to **Sepolia** via the template's deploy scripts; record addresses in `frontend/src/config/contracts.ts` and README.
- Verify contracts on Etherscan if straightforward; skip if it fights back.
- Seed a demo epoch after deploy (script): mint cTOKEN to two demo wallets, fund vault with cUSDT, open epoch.

## 9. Non-goals (do not build)

No DEX/AMM integration, no keepers/automation, no pro-rata fills, no offer cancellation, no multiple concurrent epochs, no governance, no gas golf, no audits, no mainnet, no encrypted limit prices (stretch only if everything else is done and tested).

## 10. README must include

Problem statement (buybacks get front-run / market-timed), architecture diagram (ASCII fine), the privacy table from §3, the `FHE.min` running-budget pattern explained, honest limitations (FCFS, participation metadata visible, treasury solvency unverified on-chain), setup + deploy instructions, Sepolia addresses, and live demo URL.

## 11. Submission checklist (human tasks, not for Claude Code)

- [ ] Live demo on Vercel (Sepolia)
- [ ] Public GitHub repo (contracts + frontend)
- [ ] 3-min real-person video: 30s problem → 60s live demo (two wallets) → 60s what's encrypted + FHE.min pattern → 30s delayed disclosure
- [ ] X thread introducing the project (lead with the front-running problem; show the fill formula)