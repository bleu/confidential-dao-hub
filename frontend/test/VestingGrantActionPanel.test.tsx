import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recipientOnlyGrant, treasury, treasuryOnlyGrant } from "./fixtures/vesting-grants.mjs";

const wallet = treasury;

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wallet, chainId: 11155111 }),
  usePublicClient: () => ({}),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
}));
vi.mock("../src/lib/decryption-context", () => ({ useDecryption: () => ({}) }));
vi.mock("../src/lib/useTx", () => ({
  useTx: () => ({ sendWithReceipt: vi.fn(), pending: null }),
}));

import { VestingGrantActionPanel } from "../src/features/vesting/VestingGrantActionPanel";

const amounts = { allocation: 100n, claimed: 10n, refundEntitlement: 0n, refunded: 0n };

describe("VestingGrantActionPanel", () => {
  afterEach(cleanup);

  it("shows Claim available only in the recipient workspace", () => {
    render(
      <VestingGrantActionPanel
        workspace="community"
        grant={recipientOnlyGrant}
        amounts={amounts}
        refreshPrivateAccounting={async () => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Claim available" })).toBeTruthy();

    cleanup();
    render(
      <VestingGrantActionPanel
        workspace="dao"
        grant={recipientOnlyGrant}
        amounts={amounts}
        refreshPrivateAccounting={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Claim available" })).toBeNull();
  });

  it("shows revocation only for a revocable treasury grant and explains preserved claims", () => {
    render(
      <VestingGrantActionPanel
        workspace="dao"
        grant={treasuryOnlyGrant}
        amounts={amounts}
        refreshPrivateAccounting={async () => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Revoke grant" })).toBeTruthy();
    expect(screen.getByText(/Vested but unclaimed tokens remain claimable/)).toBeTruthy();

    cleanup();
    render(
      <VestingGrantActionPanel
        workspace="dao"
        grant={{ ...treasuryOnlyGrant, revocable: false }}
        amounts={amounts}
        refreshPrivateAccounting={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke grant" })).toBeNull();
  });

  it("offers a refund retry only after private accounting confirms an outstanding refund", () => {
    const revoked = { ...treasuryOnlyGrant, revokedAt: 1_750_000_000n };
    render(
      <VestingGrantActionPanel
        workspace="dao"
        grant={revoked}
        amounts={{ ...amounts, refundEntitlement: 90n, refunded: 30n }}
        refreshPrivateAccounting={async () => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry refund" })).toBeTruthy();

    cleanup();
    render(
      <VestingGrantActionPanel
        workspace="dao"
        grant={revoked}
        amounts={amounts}
        refreshPrivateAccounting={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry refund" })).toBeNull();
  });
});
