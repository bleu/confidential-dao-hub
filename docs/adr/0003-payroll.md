---
status: accepted
---

# Confidential employee payroll

Priority: **todo**. App status: **Soon** until implementation and Sepolia verification are complete. Payroll covers DAO-initiated employee payments and is distinct from recipient-initiated Payment Requests. It owns independent custody, authorization, deployment configuration, and frontend decryption scope, following ADR 0001.

One administrator manages a saved employee roster with encrypted default salaries organized by token. Employee names are not stored on-chain. Each manually approved run snapshots at most ten recipients and their amounts, uses one token, and pushes payments in one transaction through an **Approve and pay** action. There are no separately approved pending runs, recurring execution, or employee claims. Roster edits affect future runs; removal preserves payment history and employees' access to their own historical amounts.

One payroll contract accepts compatible Zama ERC-7984 token addresses across runs, without hardcoding a single asset. Funding and accounting are isolated by token. The Sepolia frontend initially uses the existing mock cUSDT. The contract is prefunded, and the administrator may withdraw unused funds. This is a single-admin DAO deployment, not a multi-tenant shared treasury.

Actual token-call reverts propagate and roll back the whole run. Because confidential insufficient-balance checks can return encrypted zero instead of reverting, check the encrypted batch total against available funding and gate every payment on that result. For the existing token this must produce all requested payments or all zero; a zero-funded attempt remains retryable. Account for actual transfers and prevent duplicate payments on retries on-chain, independently of UI state. Avoid overflow in batch totals. Token-specific restrictions require explicit compatibility validation: the ERC-7984 interface alone does not prove that arbitrary implementations preserve the same all-or-zero behavior. Do not claim universal atomic payment success from interface compatibility.

Recipient addresses, token addresses, roster size, and activity timing are public. Amounts, aggregates, and payment outcomes have no automatic public disclosure. The administrator can decrypt all payroll amounts and outcomes; employees can decrypt only their own amounts. A confirmed transaction does not imply payment; the frontend verifies results privately and keeps decryption errors distinct from zero-payment results. Wallet, chain, or feature-scope changes clear plaintext and invalidate pending private reads.

Deliver contract unit tests, the Sepolia deployment, and integrated administrator/employee frontend flows. Validate actual-transfer accounting, insufficient funding, retries, rollback, token isolation, amount bounds, and decryption authorization; preserve existing buyback behavior.
