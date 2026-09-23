# Community and DAO layout prototype

Question: Which layout makes it easiest to move between wallet-focused community activity and the public DAO dashboard?

This is throwaway UI on branch `prototype/community-dao-layout`. No layout has been selected yet. All prototype amounts, wallet roles, epochs, and actions are simulated. The existing header wallet does not control the simulation. No prototype action requests a signature or sends a transaction. Demo DAO is a placeholder name for the one configured cTOKEN deployment.

## Run

From the repository root, run `npm --prefix frontend run dev`. Open `http://localhost:3000/?variant=A`.

- `?variant=A`: workspace rail, with persistent feature navigation on the left.
- `?variant=B`: top navigation, with wider content and side-by-side workspace choices.
- `?variant=C`: task directory, with breadcrumbs, stacked choices, and supporting navigation on the right.

Use the floating arrows or keyboard left/right arrows to change layouts. The selected layout is in the URL. Navigation, simulated wallet, inputs, and displayed private values stay in memory. Expand Prototype state to inspect them. Changing the simulated wallet or page clears displayed private values.

## Try

1. Choose Community, open the cTOKEN buyback, and view its public report.
2. Return to the buyback. Select Community wallet in the prototype controls. Preview an offer and decrypt the sample claim amount.
3. Switch to DAO dashboard. Open Buybacks. The community wallet cannot use treasury controls or decrypt the budget.
4. Select Treasury wallet. Decrypt the sample budget and try a treasury action.
5. Switch to Disconnected. Private values are cleared; the pages remain open.
6. Open My vesting or My payroll. Both show Soon, with no recipient data loaded.
7. Repeat with the other layouts, including a narrow browser window.

The existing catalog remains at `/` without a variant. `/buybacks` is unchanged and remains the real transaction-enabled demo. Production builds show the original catalog even with a variant parameter.

## Scope and next step

One DAO only. No onboarding, DAO selector, cross-DAO data loading, new recipient pages, or contract changes. Both workspaces use the same prototype report content. Report links and feature navigation stay within the prototype and do not define final route paths.

Choose a layout or specify parts to combine. Then implement it with the real feature components and their existing authorization, decryption, and transaction flows. Prototype controls simplify those flows and are not implementation specifications. Keep the full prototype on its throwaway branch as the source for that decision; do not merge these components into production.
