import { expect } from "chai";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJournal,
  isAclAccessDenied,
  LiveEvidenceError,
  parsePaymentAmount,
  safeFailureMessage,
  verifyRequestedAndActual,
} from "../../scripts/payroll/live-evidence";

describe("payroll live evidence guards", function () {
  it("fails closed when the configured journal already exists", function () {
    const directory = mkdtempSync(join(tmpdir(), "payroll-live-evidence-"));
    const journal = join(directory, "journal.json");
    try {
      createJournal(journal, {
        chainId: "11155111",
        token: "token",
        multisend: "multisend",
        sender: "sender",
        recipients: ["recipient"],
      });
      expect(existsSync(journal)).to.equal(true);
      expect(JSON.parse(readFileSync(journal, "utf8"))).to.deep.equal({
        version: 1,
        metadata: {
          chainId: "11155111",
          token: "token",
          multisend: "multisend",
          sender: "sender",
          recipients: ["recipient"],
        },
        actions: [],
      });
      writeFileSync(
        journal,
        JSON.stringify({
          version: 1,
          metadata: { chainId: "11155111", token: "token", multisend: "multisend", sender: "sender", recipients: [] },
          actions: [{ name: "underfunded submission", status: "pending" }],
        }),
      );
      expect(() =>
        createJournal(journal, {
          chainId: "11155111",
          token: "token",
          multisend: "multisend",
          sender: "sender",
          recipients: ["recipient"],
        }),
      ).to.throw("PAYROLL_LIVE_JOURNAL already exists");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects amounts outside the one-faucet funded batch range without exposing the input", function () {
    expect(parsePaymentAmount("1000000000")).to.equal(1_000_000_000n);
    for (const amount of ["", "-1", "1000000001", "private-amount"]) {
      expect(() => parsePaymentAmount(amount)).to.throw("PAYROLL_LIVE_PAYMENT_AMOUNT");
      try {
        parsePaymentAmount(amount);
      } catch (error) {
        if (amount) expect((error as Error).message).not.to.include(amount);
      }
    }
  });

  it("compares each requested value with its expected input before accepting actual outcomes", function () {
    expect(() => verifyRequestedAndActual([8n, 0n], [7n], true)).to.throw(
      "Private requested and actual payment evidence",
    );
    expect(() => verifyRequestedAndActual([7n, 6n], [7n], true)).to.throw(
      "Private requested and actual payment evidence",
    );
    expect(() => verifyRequestedAndActual([7n, 7n, 9n, 9n], [7n, 9n], false)).not.to.throw();
  });

  it("does not classify generic errors as ACL access denials", function () {
    expect(isAclAccessDenied(new Error("network unavailable"))).to.equal(false);
    expect(isAclAccessDenied({ name: "ACLUserDecryptionError" })).to.equal(true);
  });

  it("does not print raw internal errors", function () {
    const secret = "0x0123456789abcdef";
    expect(safeFailureMessage(new Error(secret))).to.equal(
      "Live evidence stopped without disclosing an internal error.",
    );
    expect(safeFailureMessage(new LiveEvidenceError("safe failure"))).to.equal("safe failure");
  });
});
