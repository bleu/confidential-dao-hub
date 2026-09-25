import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { contractGrant, unconfiguredToken } from "./fixtures/vesting-grants.mjs";
import { VestingGrantList } from "../src/features/vesting/VestingGrantList";

const grant = contractGrant(7n, { token: unconfiguredToken });

describe("VestingGrantList", () => {
  afterEach(cleanup);

  it("links the DAO created-grant view to a grant detail", () => {
    render(
      <VestingGrantList
        workspace="dao"
        state="ready"
        grants={[grant]}
        hrefFor={(id) => `/dao/vesting/${id}`}
      />,
    );

    expect(screen.getByRole("link", { name: "Grant 7" }).getAttribute("href")).toBe("/dao/vesting/7");
    expect(screen.getByText(unconfiguredToken)).toBeTruthy();
    expect(screen.getByText("Created by me")).toBeTruthy();
  });

  it("shows discovery errors without rendering grants", () => {
    render(
      <VestingGrantList
        workspace="community"
        state="error"
        grants={[grant]}
        hrefFor={(id) => `/community/vesting/${id}`}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Could not read grants");
    expect(screen.queryByRole("link", { name: "Grant 7" })).toBeNull();
  });

  it("shows a loading state before public grants arrive", () => {
    render(
      <VestingGrantList
        workspace="dao"
        state="loading"
        grants={[]}
        hrefFor={(id) => `/dao/vesting/${id}`}
      />,
    );

    expect(screen.getByText("Loading grants…")).toBeTruthy();
  });

  it("shows a role-specific empty state", () => {
    render(
      <VestingGrantList
        workspace="community"
        state="empty"
        grants={[]}
        hrefFor={(id) => `/community/vesting/${id}`}
      />,
    );

    expect(screen.getByText("No received by me grants were found.")).toBeTruthy();
  });
});
