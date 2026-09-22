---
status: accepted
---

# Preserve the implemented rolling buyback pool

This is a retrospective record of the current PoC, not a new settlement design. `BuybackVault` allocates encrypted fills first-come-first-served against an encrypted running token budget. This keeps allocation constant-work per offer, avoiding sorting or redistribution over sellers. One offer per seller per epoch is supported.

Epochs roll at an oracle price snapshot, with remaining budget carried forward. Anyone can roll after expiry; the owner can roll early. Submission rolls an expired epoch automatically. Confidential top-ups change the token budget; vault payment funding is a separate operation. Seller price floors are encrypted and applied at claim time, when the vault calculates payout and refund. Prices use two decimals; token amounts use six.

The owner-set mock oracle implements `IPriceOracle`. Demo tokens are mintable ERC-7984 mocks. Preserve names, interfaces, deployment IDs, and configured Sepolia addresses during the hub refactor.

## Privacy and consequences

Amounts and seller floors are encrypted. Sellers receive decryption access to their own offer, fill, and floor; the owner receives access to budget and aggregate state. Participation, timing, oracle prices, and operator approvals remain public. Five minutes after settlement, anyone can request public aggregate decryption and submit a KMS proof to finalize disclosure.

These implementation limitations remain explicit:

- Vault solvency is not enforced. An underfunded claim can consume entitlement while transferring zero payment.
- Failed price floors reduce totals at claim time; reserved capacity is not redistributed within the epoch.
- Disclosure is a snapshot, not immutable final settlement accounting. Claims can change the aggregate handle after a disclosure request.
- The vault has no treasury collection function for purchased tokens.
- The mock oracle, open demo faucets, and owner early-roll permission are PoC behavior.

See the [buybacks guide](../features/buybacks.md) for operation and deployment details. These limitations are preserved for compatibility, not endorsed as guarantees for new features or real-value use.
