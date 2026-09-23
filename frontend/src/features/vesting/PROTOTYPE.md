# Vesting UI prototype

Question: Which structure makes the mocked vesting flow easiest to understand before production frontend work starts?

This is throwaway UI on `prototype/vesting-ui`. It uses fixed, in-memory sample data. It does not read a wallet, request a signature, call a contract, use a relayer, load an indexer, or send a transaction.

## Run

From the repository root:

```bash
npm --prefix frontend run dev
```

Open one of these development-only URLs:

- `http://localhost:3000/dao/vesting?variant=A`
- `http://localhost:3000/community/vesting?variant=A`

Replace `A` with `B` or `C`. The fixed control at the bottom, or Left and Right arrow keys, changes the variant. The selected variant stays in the URL.

- A: Grant workbench. A grant list, detail panel, and action status are visible at once.
- B: Lifecycle sequence. Grant creation and recipient claim steps lead the page.
- C: Action inbox. Work that needs attention appears before the grant ledger.

The usual sidebar remains Soon. Direct URLs are intentional so the prototype does not release Vesting early.

## Try

1. In DAO, create a sample grant. Move through authorization, submitting, mined awaiting private verification, funded, zero funded, and rejected states.
2. Select `GR-1048`, read the sample private values, then change the mock wallet, chain, or feature scope while decryption is pending. The stale result must not restore the values.
3. In Community, read a private grant and move a claim through paid, zero payout, and rejected outcomes.
4. In DAO, open `GR-0971` and retry its sample outstanding refund. A failed refund keeps vesting stopped.
5. Repeat the flows with all three variants and on a narrow browser window.

All amounts are samples. An action preview or available amount is an estimate, not proof of a payment or funding result.

## After review

Record the selected variant and reason on GTM-580. Keep this full prototype on its throwaway branch as the source record. Build the selected UI again for GTM-577, GTM-578, and GTM-579. Do not merge the switcher or mocked flows into production code.
