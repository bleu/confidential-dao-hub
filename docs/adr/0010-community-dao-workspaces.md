---
status: accepted
---

# Separate Community and DAO workspaces

Move the Community and treasury split out of individual features into a shared left sidebar. The home page lets visitors choose Community or the DAO dashboard. One person can use both, so these workspaces do not define roles or grant access. Use short labels and show permission reasons beside restricted controls rather than repeating explanatory paragraphs.

Community starts with a buyback list, then the seller's offer and claim tools. Use "Sell cTOKEN" for the listing action. The DAO dashboard starts with an overview of the current DAO, then its tools to create and manage the buyback. "Create buyback" starts the existing vault's first epoch; it does not deploy or fund a vault. Both areas link to one public buyback report. Vesting, Payroll, Payment Requests, Token Launchpad, Governance, and Airdrop / Staking remain Soon in both workspaces. The eventual Community views for Vesting and Payroll should show the connected wallet's grants and payments across DAOs, while buybacks remain browsable. This does not implement those views or their data discovery.

## Scope and access

Keep the existing Sepolia deployment and use `cTOKEN DAO` as its display label. There is no DAO registry, onboarding, selector, or cross-DAO data loading. Feature-owned addresses, contracts, and transaction flows stay unchanged. Existing demo faucets and mock oracle controls remain clearly labeled as demo dependencies.

Anyone may open either workspace without a wallet. Contract permissions determine which actions and private values are available. Keep unauthorized controls visible but disabled with a short reason. Treasury ciphertexts offer Decrypt only to the vault owner on the supported chain; the mock oracle uses its own owner. Public epoch rolling after expiry and eligible aggregate disclosure remain available to any connected wallet on Sepolia. Workspace selection never grants permissions.

Mount the existing feature-scoped `DecryptionProvider` on each private buyback page. Leaving the page clears plaintext and invalidates pending results; wallet, chain, and scope changes retain the same isolation. The public report does not need a private decryption provider. An access change must also prevent cached plaintext from being displayed by an unauthorized control.

## Routes

- `/`: workspace chooser.
- `/community/buybacks`: configured buyback list.
- `/community/buybacks/ctoken`: sell and claim.
- `/dao`: current DAO overview.
- `/dao/buybacks`: treasury tools.
- `/buybacks/report`: shared public report. A validated `workspace=community|dao` parameter selects navigation and the return link only.
- Under both `/community` and `/dao`: `/vesting`, `/payroll`, `/payment-requests`, `/token-launchpad`, `/governance`, and `/airdrop-staking` are Soon pages without private reads or actions.

Soon features appear as non-clickable labels in the sidebar and DAO overview. Their placeholder URLs remain available for direct visits.

Redirect `/community` and the old `/buybacks` entry to `/community/buybacks`. Normal links give each screen a reloadable URL and preserve browser back navigation.

## Trade-offs and design source

Feature-local tabs would keep unrelated tasks together and require each feature to repeat the same audience split. Wallet-gated dashboards would prevent public inspection and fail for people who both run a treasury and receive payments. A global DAO selector would incorrectly scope Community's future wallet-wide activity. We chose public workspaces with feature-owned permissions instead, accepting more routes and a new decryption session after leaving a private page.

The selected design is prototype A, with reduced copy, saved on [`prototype/community-dao-layout`](https://github.com/bleu/confidential-dao-hub/tree/prototype/community-dao-layout), commit [`cb25d1e`](https://github.com/bleu/confidential-dao-hub/commit/cb25d1e). The prototype's simulated data, wallet controls, layout variants, and fake actions stay off the implementation branch. Production reuses the existing buyback panels; the prototype is a layout source, not a contract or transaction specification.

This decision keeps the feature boundaries in [ADR 0001](0001-independent-feature-contracts.md), the buyback behavior and limitations in [ADR 0002](0002-buybacks.md), and the delivery stages in [ADR 0009](0009-feature-delivery-stages.md).
