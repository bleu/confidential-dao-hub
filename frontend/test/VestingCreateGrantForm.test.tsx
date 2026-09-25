import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VestingCreateGrantForm } from "../src/features/vesting/CreateGrantPanel";

const treasury = "0x8cD4f98429399E4E9f0b4B9C7d8A34c5E93248A1";
const recipient = "0x71B5c1167cE82040dE1a1BEf47d4a32e8431A9D4";
const tokens = [
  {
    address: "0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f" as const,
    symbol: "cTOKEN",
    decimals: 6,
  },
  {
    address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA" as const,
    symbol: "cUSDT",
    decimals: 6,
  },
];

function renderForm(onConfirm = vi.fn()) {
  render(
    <VestingCreateGrantForm
      treasury={treasury}
      tokens={tokens}
      nowSeconds={1_750_000_000n}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("VestingCreateGrantForm", () => {
  afterEach(cleanup);

  it("blocks review until the grant terms and vesting duration are valid", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Review grant" }));

    expect(screen.getByText("Enter a positive whole duration.")).toBeTruthy();
  });

  it("offers both tokens and uses now, days, zero cliff, and not revocable by default", () => {
    renderForm();

    expect(screen.getByRole("option", { name: "cTOKEN" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "cUSDT" })).toBeTruthy();
    expect((screen.getByLabelText("Vesting unit") as HTMLSelectElement).value).toBe("day");
    expect((screen.getByLabelText("Cliff duration") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Not revocable") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Custom start date")).toBeNull();
  });

  it("derives immutable terms from durations and a custom calendar date", async () => {
    const user = userEvent.setup();
    const onConfirm = renderForm();

    await user.type(screen.getByLabelText("Recipient"), recipient);
    await user.type(screen.getByLabelText("Allocation"), "12.5");
    await user.selectOptions(screen.getByLabelText("Token"), tokens[1].address);
    await user.type(screen.getByLabelText("Vesting duration"), "2");
    await user.selectOptions(screen.getByLabelText("Vesting unit"), "year");
    await user.clear(screen.getByLabelText("Cliff duration"));
    await user.type(screen.getByLabelText("Cliff duration"), "1");
    await user.selectOptions(screen.getByLabelText("Cliff unit"), "month");
    await user.click(screen.getByLabelText("Set custom start date"));
    await user.type(screen.getByLabelText("Custom start date"), "2025-01-01");
    await user.click(screen.getByLabelText("Revocable"));
    await user.click(screen.getByRole("button", { name: "Review grant" }));

    expect(screen.getByText("cUSDT")).toBeTruthy();
    expect(screen.getByText("Revocable")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm grant" }));

    expect(onConfirm).toHaveBeenCalledWith({
      recipient,
      token: tokens[1].address,
      allocation: 12_500_000n,
      start: 1_735_689_600n,
      end: 1_798_761_600n,
      cliff: 1_738_281_600n,
      revocable: true,
    });
  });
});
