# Confidential Ops Hub frontend

Next.js frontend for confidential DAO treasury operations. `/` opens the workspace chooser. Community lists buybacks at `/community/buybacks` and opens sell/claim at `/community/buybacks/ctoken`. The DAO overview is at `/dao`, with treasury tools at `/dao/buybacks`. Both areas use `/buybacks/report`; its optional `workspace` parameter affects navigation only. The old `/buybacks` route redirects to the list.

Anyone can browse either area. The DAO creates and manages its buyback; Community members sell tokens and claim payments. Vesting, Payroll, Payment Requests, Token Launchpad, Governance, and Airdrop / Staking stay Soon in both workspaces. Treasury actions and private amounts depend on the connected wallet's contract permissions, not the selected workspace. The existing Sepolia faucet and mock oracle remain demo tools.

See the [root README](../README.md) for setup and [ADR 0010](../docs/adr/0010-community-dao-workspaces.md) for the decision. Buyback components, ABIs, and deployment addresses live in `src/features/buybacks/`; shared UI and infrastructure live in `src/components/` and `src/lib/`.

Private buyback pages mount an explicit `DecryptionProvider` scope. Leaving the page clears plaintext and invalidates pending requests. Wallet, chain, or scope changes replace the private state. The public report has no private provider. The SDK loader remains browser-only and initializes lazily.

Run `npm run dev` here to start the app. Run `npm test`, `npm run lint`, and `npm run build` before submitting changes. Tests cover navigation selection, permission decisions, decryption scope, wallet isolation, session reuse/expiry, retries, and invalidation of pending requests.
