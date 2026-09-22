---
status: accepted
---

# Caller-funded confidential multisend for payroll

Payroll uses an independent, permissionless confidential multisend, following [ADR 0001](0001-independent-feature-contracts.md). Each call supplies one ERC-7984 token, 1-10 payment entries, and encrypted amounts. The sender pays from their own token balance and grants the multisend a time-limited operator permission. There is no administrator, employee roster, saved salary, advance funding, managed payroll balance, or run lifecycle. This decision replaces the previous administrator-led, prefunded payroll design. It reduces custody and saved state, but requires the sender to supply and review every batch.

The multisend checks the encrypted total for overflow, pulls that total from the caller, and gates every outgoing payment on this call's actual pull. For supported standard token behavior, every entry receives its requested amount or every entry receives zero. Insufficient funds and total overflow produce encrypted zero payments; a confirmed transaction alone does not prove a positive payment. Existing contract funds must not cover a failed pull. Token-call reverts propagate and roll back the whole transaction. Token-call boundaries are protected against reentrancy.

ERC-7984 interface compatibility alone does not establish the all-or-zero guarantee. Supported tokens must transfer the full requested amount or zero on insufficient balance, return the actual amount, preserve standard balance accounting, and apply no custom fees, partial transfers, or encrypted transfer restrictions. A custom token can violate these assumptions and leave funds stuck or produce mixed outcomes. There is no token allowlist, recovery function, or withdrawal function. Tokens sent directly to the multisend can remain stuck.

Payment logs expose the sender, token, recipient, and encrypted references to the requested and actual amounts for each entry. The sender can decrypt their batch's amounts; each recipient can decrypt only their own payment amounts. Addresses, batch size, and timing are public. Amounts, totals, and payment success have no automatic public disclosure. Logs provide discovery without separate history storage or read indexes.

Zero amounts and repeated recipients are valid. Each transaction is a new payment request, with no saved run ID, expiry rule, duplicate-request protection, or retry accounting. Operator permission expiry belongs to the token and is not an amount-limited allowance. Input review and duplicate-click prevention belong to the future frontend. Payroll remains Soon in the app until the delivery stages in [ADR 0009](0009-feature-delivery-stages.md) are complete. Contract behavior and token requirements are documented in the [payroll guide](../features/payroll.md).
