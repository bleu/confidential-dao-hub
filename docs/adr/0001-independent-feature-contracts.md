---
status: accepted
---

# Independent feature contracts in one Confidential Ops Hub

Expand the buybacks repository into a hub for DAO treasury teams, with one frontend and independent contracts per feature. Share wallet connection, FHE utilities, and presentation components, while keeping feature-specific custody, authorization, ABIs, and deployment configuration within each feature. This allows operations to evolve independently without committing every feature to the buyback vault's financial or privacy model.

A shared treasury/permissions contract would create coupling before payroll, payment requests, vesting, and governance have settled requirements. Separate contracts cost more deployment and integration work, but keep those decisions reversible at the feature boundary. Each feature must define private values, authorized readers, public metadata, and disclosure policy; delayed aggregate disclosure is currently a buyback behavior.

Keep one Next.js project and one Hardhat project, plus a root domain glossary and ADR directory. The first hub version retains the existing configured Sepolia deployment and buyback behavior. DAO onboarding, deployment factories/discovery, and cross-feature permissions remain future decisions. The UI labels every unimplemented feature Soon while documentation retains its todo/backlog priority.

Frontend decryption permissions are explicit per feature. Each wallet/chain/scope has isolated session and plaintext state; clearing a session also invalidates pending results. This separates shared SDK infrastructure from buyback-specific contract addresses.
