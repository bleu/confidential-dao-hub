import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VestingCreateGrantForm } from "../src/features/vesting/CreateGrantPanel";

const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const recipient = "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4";
const token = {
  address: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f" as const,
  symbol: "cTOKEN",
  decimals: 6,
};

function renderForm(onConfirm = vi.fn()) {
  render(
    <VestingCreateGrantForm
      treasury={treasury}
      tokens={[token]}
      nowSeconds={1_750_000_000n}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("VestingCreateGrantForm", () => {
  afterEach(cleanup);

  it("blocks review until the grant terms are valid", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Review grant" }));

    expect(screen.getByText("Enter a recipient wallet.")).toBeTruthy();
    expect(screen.getByText("Enter a positive allocation.")).toBeTruthy();
  });

  it("reviews immutable terms and confirms a cliff-gated backdated grant", async () => {
    const user = userEvent.setup();
    const onConfirm = renderForm();

    await user.type(screen.getByLabelText("Recipient"), recipient);
    await user.type(screen.getByLabelText("Allocation"), "12.5");
    await user.clear(screen.getByLabelText("Start"));
    await user.type(screen.getByLabelText("Start"), "2023-11-14");
    await user.clear(screen.getByLabelText("End"));
    await user.type(screen.getByLabelText("End"), "2027-01-15");
    await user.clear(screen.getByLabelText("Cliff"));
    await user.type(screen.getByLabelText("Cliff"), "2026-01-15");
    await user.click(screen.getByRole("button", { name: "Review grant" }));

    expect(screen.getByText("Fixed treasury")).toBeTruthy();
    expect(screen.getByText(treasury)).toBeTruthy();
    expect(screen.getByText("Not revocable")).toBeTruthy();
    expect(screen.getByText("The cliff has not passed. Accrued tokens are not available yet.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm grant" }));

    expect(onConfirm).toHaveBeenCalledWith({
      recipient,
      token: token.address,
      allocation: 12_500_000n,
      start: 1_699_920_000n,
      end: 1_799_971_200n,
      cliff: 1_768_435_200n,
      revocable: false,
    });
  });
});
