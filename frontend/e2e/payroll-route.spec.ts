import { expect, test } from "@playwright/test";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const account = "0x1111111111111111111111111111111111111111";
const tokenMetadataResult = encodeAbiParameters(
  parseAbiParameters("(bool success, bytes returnData)[]"),
  [[
    { success: true, returnData: encodeAbiParameters(parseAbiParameters("string"), ["cUSDT"]) },
    { success: true, returnData: encodeAbiParameters(parseAbiParameters("uint8"), [6]) },
    { success: true, returnData: encodeAbiParameters(parseAbiParameters("bool"), [false]) },
  ]],
);

async function installPayrollRpc(page: import("@playwright/test").Page, receiptStatus = "0x1") {
  await page.route("https://ethereum-sepolia-rpc.publicnode.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS" } });
      return;
    }
    const payload = JSON.parse(request.postData() ?? "{}") as { id: number; method: string; params?: unknown[] } | Array<{ id: number; method: string; params?: unknown[] }>;
    const reply = (call: { id: number; method: string; params?: unknown[] }) => {
      if (call.method === "eth_chainId") return { jsonrpc: "2.0", id: call.id, result: "0xaa36a7" };
      if (call.method === "eth_getTransactionReceipt") {
        return { jsonrpc: "2.0", id: call.id, result: { blockHash: `0x${"1".repeat(64)}`, blockNumber: "0x1", contractAddress: null, cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x1", from: account, gasUsed: "0x5208", logs: [], logsBloom: `0x${"0".repeat(512)}`, status: receiptStatus, to: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA", transactionHash: `0x${"2".repeat(64)}`, transactionIndex: "0x0", type: "0x2" } };
      }
      if (call.method === "eth_call") {
        const data = ((call.params?.[0] as { data?: string })?.data ?? "").slice(0, 10);
        if (data === "0x82ad56cb") return { jsonrpc: "2.0", id: call.id, result: tokenMetadataResult };
        if (data === "0x95d89b41") {
          return { jsonrpc: "2.0", id: call.id, result: "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000056355534454000000000000000000000000000000000000000000000000000000" };
        }
        if (data === "0x313ce567") return { jsonrpc: "2.0", id: call.id, result: "0x0000000000000000000000000000000000000000000000000000000000000006" };
      }
      return { jsonrpc: "2.0", id: call.id, result: "0x" };
    };
    const response = Array.isArray(payload) ? payload.map(reply) : reply(payload);
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(response) });
  });
}

async function installWallet(page: import("@playwright/test").Page, chainId: string) {
  await page.addInitScript(({ account, initialChainId }) => {
    let activeChainId = initialChainId;
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const emit = (event: string, value: unknown) => {
      listeners.get(event)?.forEach((listener) => listener(value));
    };

    window.ethereum = {
      isMetaMask: true,
      on(event: string, listener: (value: unknown) => void) {
        const current = listeners.get(event) ?? new Set();
        current.add(listener);
        listeners.set(event, current);
      },
      removeListener(event: string, listener: (value: unknown) => void) {
        listeners.get(event)?.delete(listener);
      },
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === "eth_chainId") return activeChainId;
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "eth_sendTransaction") return `0x${"2".repeat(64)}`;
        if (method === "wallet_switchEthereumChain") {
          activeChainId = (params?.[0] as { chainId: string }).chainId;
          emit("chainChanged", activeChainId);
          return null;
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
  }, { account, initialChainId: chainId });
}

test("wrong-chain wallet cannot start a payroll payment", async ({ page }) => {
  await installWallet(page, "0x1");
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();

  await expect(page.getByRole("button", { name: "switch to Sepolia" })).toBeVisible();
  await expect(page.getByText("Switch to Sepolia before preparing a payroll payment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize multisend" })).toBeDisabled();
});

test("Sepolia payroll starts with cUSDT selected", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page);
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();

  await expect(page.getByLabel("Payment token")).toHaveValue("0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA");
});

test("Sepolia payroll only offers cUSDT and cTOKEN", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page);
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();

  const token = page.getByLabel("Payment token");
  await expect(token.locator("option")).toHaveText(["cUSDT", "cTOKEN"]);
  await token.selectOption("0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f");
  await expect(token).toHaveValue("0xa2E95Db3Bb2f2B02b2990c66A74534D79684D80f");
});

test("Sepolia payroll reads the selected token identity", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page);
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();

  await expect(page.getByText("cUSDT · 6 decimals")).toBeVisible();
});

test("Sepolia wallet can authorize the multisend after token reads load", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page);
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();

  await expect(page.getByRole("button", { name: "Authorize multisend" })).toBeEnabled();
});

test("successful operator authorization unlocks payment preparation", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page);
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();
  await page.getByRole("button", { name: "Authorize multisend" }).click();

  await expect(page.getByRole("button", { name: "Send payment" })).toBeEnabled();
});

test("a reverted operator authorization keeps payment preparation locked", async ({ page }) => {
  await installWallet(page, "0xaa36a7");
  await installPayrollRpc(page, "0x0");
  await page.goto("/dao/payroll");

  await page.getByRole("button", { name: "connect wallet" }).click();
  await page.getByRole("button", { name: "Authorize multisend" }).click();

  await expect(page.getByText("Transaction reverted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize multisend" })).toBeEnabled();
});
