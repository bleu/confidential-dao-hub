# Confidential Ops Hub frontend

Next.js frontend for confidential DAO treasury operations. `/` lists operations and `/buybacks` contains the implemented buyback flow. Every other operation is labeled **Soon**.

See the [root README](../README.md) for setup and checks. Buyback components, ABIs, and deployment addresses live in `src/features/buybacks/`; shared UI and infrastructure live in `src/components/` and `src/lib/`.

Private values must use a feature's explicit `DecryptionProvider` scope. Its state is replaced on wallet, chain, or scope changes. The SDK loader remains browser-only and initializes lazily.

Run `npm run dev` here to start the app. Run `npm test`, `npm run lint`, and `npm run build` before submitting changes. Tests cover decryption scope, wallet isolation, session reuse/expiry, retries, and invalidation of pending requests.
