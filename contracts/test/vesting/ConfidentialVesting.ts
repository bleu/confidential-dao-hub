import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { mine, takeSnapshot, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers, fhevm } from "hardhat";

import { GenericConfidentialToken, ConfidentialVesting } from "../../types";

describe("ConfidentialVesting", function () {
  let treasury: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;
  let token: GenericConfidentialToken;
  let vesting: ConfidentialVesting;
  let address: string;
  let start: number;
  let end: number;

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    [treasury, recipient, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("GenericConfidentialToken")).deploy("Token", "TOK", 10_000n);
    vesting = await (await ethers.getContractFactory("ConfidentialVesting")).deploy();
    address = await vesting.getAddress();
    start = (await time.latest()) + 100;
    end = start + 400;
    await token.setOperator(address, end + 1000);
  });

  async function create(amount = 1000n, from = treasury, to = recipient, asset = token, cliff = 0, revocable = true) {
    const input = await fhevm.createEncryptedInput(address, from.address).add64(amount).encrypt();
    return vesting
      .connect(from)
      .createGrant(
        to.address,
        await asset.getAddress(),
        start,
        end,
        cliff,
        revocable,
        input.handles[0],
        input.inputProof,
      );
  }

  async function decrypt(handle: string, user = treasury) {
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, address, user);
  }

  it("rejects schedules with an invalid order, expired end, or out-of-range cliff", async function () {
    const now = await time.latest();
    for (const dates of [
      [end, start, 0],
      [start, start, 0],
      [now - 100, now, 0],
      [start, end, start - 1],
      [start, end, end + 1],
    ]) {
      const input = await fhevm.createEncryptedInput(address, treasury.address).add64(1000n).encrypt();
      await expect(
        vesting.createGrant(
          recipient.address,
          await token.getAddress(),
          dates[0],
          dates[1],
          dates[2],
          true,
          input.handles[0],
          input.inputProof,
        ),
      ).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    }
  });

  it("rejects unusable recipient and token addresses", async function () {
    for (const [to, asset] of [
      [ethers.ZeroAddress, await token.getAddress()],
      [address, await token.getAddress()],
      [recipient.address, ethers.ZeroAddress],
      [recipient.address, outsider.address],
    ]) {
      const input = await fhevm.createEncryptedInput(address, treasury.address).add64(1000n).encrypt();
      await expect(
        vesting.createGrant(to, asset, start, end, 0, true, input.handles[0], input.inputProof),
      ).to.be.revertedWithCustomError(vesting, "InvalidAddress");
    }
  });

  it("rejects detail reads for unknown grants", async function () {
    await expect(vesting.getGrant(0)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    await expect(vesting.getGrant(99)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
  });

  it("keeps a privately verifiable zero allocation when funding exceeds the treasury balance", async function () {
    await expect(create(10_001n))
      .to.emit(vesting, "GrantCreated")
      .withArgs(1n, treasury.address, recipient.address, await token.getAddress());
    const grant = await vesting.getGrant(1);
    expect(await decrypt(grant.allocation)).to.equal(0n);
    expect(await decrypt(grant.allocation, recipient)).to.equal(0n);
  });

  it("requires token operator authorization and rolls back a rejected funding call", async function () {
    await token.setOperator(address, 0);
    await expect(create()).to.be.revertedWithCustomError(token, "ERC7984UnauthorizedSpender");
    await expect(vesting.getGrant(1)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    await token.setOperator(address, end + 1000);
    await expect(create())
      .to.emit(vesting, "GrantCreated")
      .withArgs(1n, treasury.address, recipient.address, await token.getAddress());
  });

  it("isolates decryption rights across grants, tokens, and pooled balances", async function () {
    const [, , secondTreasury, secondRecipient] = await ethers.getSigners();
    await token.connect(secondTreasury).faucet(3000n);
    await token.connect(secondTreasury).setOperator(address, end + 1000);
    await create();
    await create(2000n, secondTreasury, secondRecipient);
    const otherToken = await (await ethers.getContractFactory("GenericConfidentialToken"))
      .connect(secondTreasury)
      .deploy("Other", "OTH", 5000n);
    await otherToken.connect(secondTreasury).setOperator(address, end + 1000);
    await create(3000n, secondTreasury, secondRecipient, otherToken);
    const first = await vesting.getGrant(1);
    const second = await vesting.getGrant(2);
    const third = await vesting.getGrant(3);
    expect(await decrypt(first.allocation)).to.equal(1000n);
    expect(await decrypt(second.allocation, secondTreasury)).to.equal(2000n);
    expect(await decrypt(third.allocation, secondRecipient)).to.equal(3000n);
    for (const handle of [first.allocation, first.claimed]) {
      await expect(decrypt(handle, secondTreasury)).to.be.rejected;
      await expect(decrypt(handle, secondRecipient)).to.be.rejected;
    }
    for (const handle of [second.allocation, second.claimed, third.allocation, third.claimed]) {
      await expect(decrypt(handle, treasury)).to.be.rejected;
      await expect(decrypt(handle, recipient)).to.be.rejected;
    }
    const pooled = await token.confidentialBalanceOf(address);
    for (const user of [treasury, recipient, secondTreasury, secondRecipient]) {
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, pooled, await token.getAddress(), user)).to.be.rejected;
    }
    await expect(fhevm.publicDecrypt([first.allocation])).to.be.rejected;
  });

  async function balance(user: HardhatEthersSigner, asset = token) {
    const handle = await asset.confidentialBalanceOf(user.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await asset.getAddress(), user);
  }

  it("lets the recipient claim half the allocation halfway through the schedule", async function () {
    await create();
    await time.setNextBlockTimestamp(start + 200);
    await expect(vesting.connect(recipient).claim(1)).to.emit(vesting, "GrantClaimed").withArgs(1n);
    expect(await balance(recipient)).to.equal(500n);
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(500n);
  });

  it("allows only the fixed recipient to claim an existing grant", async function () {
    await create();
    await time.increaseTo(start + 200);
    for (const user of [treasury, outsider]) {
      await expect(vesting.connect(user).claim(1)).to.be.revertedWithCustomError(vesting, "UnauthorizedRecipient");
    }
    await expect(vesting.connect(recipient).claim(99)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
  });

  it("keeps claims at zero before start and unlocks accrued entitlement exactly at the cliff", async function () {
    await create(1000n, treasury, recipient, token, start + 100);
    for (const timestamp of [start - 1, start, start + 99]) {
      await time.setNextBlockTimestamp(timestamp);
      await vesting.connect(recipient).claim(1);
      expect(await balance(recipient)).to.equal(0n);
      expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
    }
    await time.setNextBlockTimestamp(start + 100);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(250n);
  });

  it("pays the rounding remainder at completion and never spends another grant on later claims", async function () {
    await create(7n);
    await create(1000n, treasury, outsider);
    for (const [timestamp, paid] of [
      [start + 133, 2n],
      [end - 1, 6n],
      [end, 7n],
      [end + 400, 7n],
    ] as const) {
      await time.setNextBlockTimestamp(timestamp);
      await vesting.connect(recipient).claim(1);
      expect(await balance(recipient)).to.equal(paid);
      expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(paid);
    }
    await vesting.connect(outsider).claim(2);
    expect(await balance(outsider)).to.equal(1000n);
  });

  it("vests the maximum ERC-7984 allocation without intermediate overflow", async function () {
    token = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Maximum", "MAX", 18446744073709551615n);
    await token.setOperator(address, end + 1000);
    await create(18446744073709551615n);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(9223372036854775807n);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(18446744073709551615n);
  });

  it("recognizes vested tokens on a backdated grant at execution time", async function () {
    const now = await time.latest();
    start = now - 200;
    end = now + 200;
    await create();
    await time.setNextBlockTimestamp(now + 4);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(510n);
    expect((await vesting.getGrant(1)).start).to.equal(start);
  });

  it("preserves claim entitlement when a token returns encrypted zero", async function () {
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    await restricted.setTransferMode(recipient.address, 1);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(0n);
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
    await restricted.setTransferMode(recipient.address, 0);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(1000n);
  });

  it("preserves claim entitlement when a token reverts", async function () {
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    await restricted.setTransferMode(recipient.address, 2);
    await time.setNextBlockTimestamp(start + 200);
    await expect(vesting.connect(recipient).claim(1)).to.be.revertedWithCustomError(restricted, "TransferRejected");
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
    await restricted.setTransferMode(recipient.address, 0);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(1000n);
  });

  it("revokes at execution time, refunds only unvested tokens, and keeps earlier claims paid", async function () {
    await create();
    await time.setNextBlockTimestamp(start + 100);
    await vesting.connect(recipient).claim(1);
    await time.setNextBlockTimestamp(start + 200);
    await expect(vesting.revoke(1)).to.emit(vesting, "GrantRevoked").withArgs(1n);
    const stopped = await vesting.getGrant(1);
    expect(stopped.revoked).to.equal(true);
    expect(stopped.revokedAt).to.equal(start + 200);
    expect(await decrypt(stopped.refundEntitlement)).to.equal(500n);
    expect(await decrypt(stopped.refunded)).to.equal(500n);
    expect(await balance(treasury)).to.equal(9500n);
    await time.setNextBlockTimestamp(end + 100);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(500n);
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(500n);
  });

  it("allows only the grant treasury to revoke an existing grant once when revocable", async function () {
    await create();
    await create(1000n, treasury, recipient, token, 0, false);
    for (const user of [recipient, outsider]) {
      await expect(vesting.connect(user).revoke(1)).to.be.revertedWithCustomError(vesting, "UnauthorizedTreasury");
    }
    await expect(vesting.revoke(99)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    await expect(vesting.revoke(2)).to.be.revertedWithCustomError(vesting, "IrrevocableGrant");
    await vesting.revoke(1);
    const stopped = await vesting.getGrant(1);
    await expect(vesting.revoke(1)).to.be.revertedWithCustomError(vesting, "AlreadyRevoked");
    expect((await vesting.getGrant(1)).revokedAt).to.equal(stopped.revokedAt);
  });

  it("provides private zero refund progress before revocation without granting other wallets access", async function () {
    await create();
    const grant = await vesting.getGrant(1);
    expect(grant.revoked).to.equal(false);
    expect(grant.revokedAt).to.equal(0n);
    for (const handle of [grant.refundEntitlement, grant.refunded]) {
      expect(await decrypt(handle)).to.equal(0n);
      expect(await decrypt(handle, recipient)).to.equal(0n);
      await expect(decrypt(handle, outsider)).to.be.rejected;
    }
  });

  it("keeps vesting stopped after an encrypted-zero refund and retries only the outstanding refund", async function () {
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    await create(1000n, treasury, outsider);
    await restricted.setTransferMode(treasury.address, 1);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.revoke(1);
    const stopped = await vesting.getGrant(1);
    expect(stopped.revoked).to.equal(true);
    expect(stopped.revokedAt).to.equal(start + 200);
    expect(await decrypt(stopped.refundEntitlement)).to.equal(500n);
    expect(await decrypt(stopped.refunded)).to.equal(0n);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(500n);
    await vesting.retryRefund(1);
    expect(await decrypt((await vesting.getGrant(1)).refunded)).to.equal(0n);
    await restricted.setTransferMode(treasury.address, 0);
    await expect(vesting.retryRefund(1)).to.emit(vesting, "GrantRefundRetried").withArgs(1n);
    await vesting.retryRefund(1);
    const retried = await vesting.getGrant(1);
    expect(retried.revokedAt).to.equal(stopped.revokedAt);
    expect(await decrypt(retried.refunded)).to.equal(500n);
    expect(await balance(treasury)).to.equal(8500n);
    await vesting.connect(outsider).claim(2);
    expect(await balance(outsider)).to.equal(1000n);
  });

  it("allows refund retries only by the treasury of an existing revoked grant", async function () {
    await create();
    await expect(vesting.retryRefund(1)).to.be.revertedWithCustomError(vesting, "GrantNotRevoked");
    await expect(vesting.retryRefund(99)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    await vesting.revoke(1);
    for (const user of [recipient, outsider]) {
      await expect(vesting.connect(user).retryRefund(1)).to.be.revertedWithCustomError(vesting, "UnauthorizedTreasury");
    }
  });

  it("rolls back revocation when the initial refund reverts and continues vesting", async function () {
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    await restricted.setTransferMode(treasury.address, 2);
    await time.setNextBlockTimestamp(start + 100);
    await expect(vesting.revoke(1)).to.be.revertedWithCustomError(restricted, "TransferRejected");
    const grant = await vesting.getGrant(1);
    expect(grant.revoked).to.equal(false);
    expect(grant.revokedAt).to.equal(0n);
    expect(await decrypt(grant.refundEntitlement)).to.equal(0n);
    expect(await decrypt(grant.refunded)).to.equal(0n);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(500n);
    await restricted.setTransferMode(treasury.address, 0);
    await time.setNextBlockTimestamp(start + 300);
    await vesting.revoke(1);
    expect((await vesting.getGrant(1)).revokedAt).to.equal(start + 300);
    expect(await balance(treasury)).to.equal(9250n);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(750n);
  });

  it("preserves the original stop time and entitlement when a later refund retry reverts", async function () {
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    await restricted.setTransferMode(treasury.address, 1);
    await time.setNextBlockTimestamp(start + 100);
    await vesting.revoke(1);
    const stopped = await vesting.getGrant(1);
    await restricted.setTransferMode(treasury.address, 2);
    await time.setNextBlockTimestamp(start + 300);
    await expect(vesting.retryRefund(1)).to.be.revertedWithCustomError(restricted, "TransferRejected");
    const failedRetry = await vesting.getGrant(1);
    expect(failedRetry.revoked).to.equal(true);
    expect(failedRetry.revokedAt).to.equal(stopped.revokedAt);
    expect(await decrypt(failedRetry.refundEntitlement)).to.equal(750n);
    expect(await decrypt(failedRetry.refunded)).to.equal(0n);
    await time.setNextBlockTimestamp(end + 100);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(250n);
    await restricted.setTransferMode(treasury.address, 0);
    await vesting.retryRefund(1);
    expect(await balance(treasury)).to.equal(9750n);
    expect((await vesting.getGrant(1)).revokedAt).to.equal(stopped.revokedAt);
  });

  it("rejects a nested claim during a token call without consuming either grant", async function () {
    const callbackToken = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = callbackToken;
    await token.setOperator(address, end + 1000);
    const input = await fhevm.createEncryptedInput(address, treasury.address).add64(1000n).encrypt();
    await vesting.createGrant(
      await token.getAddress(),
      await token.getAddress(),
      start,
      end,
      0,
      true,
      input.handles[0],
      input.inputProof,
    );
    await create(1000n, treasury, outsider);
    const claim = vesting.interface.encodeFunctionData("claim", [1]);
    await callbackToken.setCallback(address, claim);
    await time.setNextBlockTimestamp(start + 200);
    await expect(callbackToken.execute(address, claim)).to.be.revertedWithCustomError(
      vesting,
      "ReentrancyGuardReentrantCall",
    );
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
    expect(await decrypt((await vesting.getGrant(2)).claimed)).to.equal(0n);
    await callbackToken.setCallback(ethers.ZeroAddress, "0x");
    await time.setNextBlockTimestamp(end);
    await callbackToken.execute(address, claim);
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(1000n);
    await vesting.connect(outsider).claim(2);
    expect(await balance(outsider)).to.equal(1000n);
  });

  it("rejects nested grant actions during funding, revocation, and refund retries", async function () {
    const callbackToken = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = callbackToken;
    await token.setOperator(address, end + 1000);
    const input = await fhevm.createEncryptedInput(address, treasury.address).add64(1000n).encrypt();
    await vesting.createGrant(
      await token.getAddress(),
      await token.getAddress(),
      start,
      end,
      0,
      true,
      input.handles[0],
      input.inputProof,
    );
    await create(1000n, treasury, outsider);
    await time.increaseTo(start + 100);
    await callbackToken.setCallback(address, vesting.interface.encodeFunctionData("claim", [1]));
    await expect(create()).to.be.revertedWithCustomError(vesting, "ReentrancyGuardReentrantCall");
    await expect(vesting.revoke(2)).to.be.revertedWithCustomError(vesting, "ReentrancyGuardReentrantCall");
    await callbackToken.setCallback(ethers.ZeroAddress, "0x");
    await callbackToken.setTransferMode(treasury.address, 1);
    await vesting.revoke(2);
    const stopped = await vesting.getGrant(2);
    await callbackToken.setCallback(address, vesting.interface.encodeFunctionData("claim", [1]));
    await expect(vesting.retryRefund(2)).to.be.revertedWithCustomError(vesting, "ReentrancyGuardReentrantCall");
    expect((await vesting.getGrant(2)).revokedAt).to.equal(stopped.revokedAt);
    expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(0n);
  });

  it("refunds the full allocation before the cliff and none at or after completion", async function () {
    for (let i = 0; i < 5; i++) await create(1000n, treasury, recipient, token, start + 100);
    const cases = [
      [start - 1, 1000n],
      [start + 99, 1000n],
      [start + 100, 750n],
      [end, 0n],
      [end + 1, 0n],
    ] as const;
    for (const [index, [timestamp, refund]] of cases.entries()) {
      await time.setNextBlockTimestamp(timestamp);
      await vesting.revoke(index + 1);
      const grant = await vesting.getGrant(index + 1);
      expect(await decrypt(grant.refundEntitlement)).to.equal(refund);
      expect(await decrypt(grant.refunded)).to.equal(refund);
    }
    for (let id = 1; id <= 5; id++) await vesting.connect(recipient).claim(id);
    expect(await balance(recipient)).to.equal(2250n);
    expect(await balance(treasury)).to.equal(7750n);
  });

  it("does not turn direct deposits into grant allocations or extra claims", async function () {
    const deposit = async () => {
      const input = await fhevm
        .createEncryptedInput(await token.getAddress(), treasury.address)
        .add64(500n)
        .encrypt();
      await token["confidentialTransfer(address,bytes32,bytes)"](address, input.handles[0], input.inputProof);
    };
    await deposit();
    await expect(vesting.getGrant(1)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    await create();
    await deposit();
    expect(await decrypt((await vesting.getGrant(1)).allocation)).to.equal(1000n);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(1000n);
    expect(await decrypt((await vesting.getGrant(1)).allocation)).to.equal(1000n);
    await expect(vesting.getGrant(2)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
  });

  it("keeps zero-funded grants empty through claims, revocation, and retries", async function () {
    await create(10_001n);
    await create(1000n, treasury, outsider);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.connect(recipient).claim(1);
    await vesting.revoke(1);
    await vesting.retryRefund(1);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    const grant = await vesting.getGrant(1);
    for (const handle of [grant.allocation, grant.claimed, grant.refundEntitlement, grant.refunded]) {
      expect(await decrypt(handle)).to.equal(0n);
      expect(await decrypt(handle, recipient)).to.equal(0n);
      await expect(decrypt(handle, outsider)).to.be.rejected;
    }
    expect(await balance(recipient)).to.equal(0n);
    await vesting.connect(outsider).claim(2);
    expect(await balance(outsider)).to.equal(1000n);
  });

  it("keeps updated amount handles private to their grant parties", async function () {
    const [, , secondTreasury, secondRecipient] = await ethers.getSigners();
    await token.connect(secondTreasury).faucet(2000n);
    await token.connect(secondTreasury).setOperator(address, end + 1000);
    await create();
    await create(2000n, secondTreasury, secondRecipient);
    await time.setNextBlockTimestamp(start + 100);
    await vesting.connect(recipient).claim(1);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.revoke(1);
    await vesting.retryRefund(1);
    const first = await vesting.getGrant(1);
    for (const [handle, expected] of [
      [first.allocation, 1000n],
      [first.claimed, 250n],
      [first.refundEntitlement, 500n],
      [first.refunded, 500n],
    ] as const) {
      expect(await decrypt(handle)).to.equal(expected);
      expect(await decrypt(handle, recipient)).to.equal(expected);
      await expect(decrypt(handle, secondTreasury)).to.be.rejected;
      await expect(decrypt(handle, secondRecipient)).to.be.rejected;
      await expect(fhevm.publicDecrypt([handle])).to.be.rejected;
    }
    await expect(vesting.revoke(2)).to.be.revertedWithCustomError(vesting, "UnauthorizedTreasury");
    await time.setNextBlockTimestamp(end);
    await vesting.connect(secondRecipient).claim(2);
    await vesting.connect(recipient).claim(1);
    expect(await balance(secondRecipient)).to.equal(2000n);
    expect(await balance(recipient)).to.equal(500n);
    const second = await vesting.getGrant(2);
    expect(await decrypt(second.claimed, secondTreasury)).to.equal(2000n);
    await expect(decrypt(second.claimed, treasury)).to.be.rejected;
    const pooled = await token.confidentialBalanceOf(address);
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, pooled, await token.getAddress(), treasury)).to.be.rejected;
  });

  it("supports a treasury that is also the recipient without mixing claims and refunds", async function () {
    await create(1000n, treasury, treasury);
    await time.setNextBlockTimestamp(start + 100);
    await vesting.claim(1);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.revoke(1);
    await time.setNextBlockTimestamp(end);
    await vesting.claim(1);
    await vesting.retryRefund(1);
    const grant = await vesting.getGrant(1);
    expect(await decrypt(grant.claimed)).to.equal(500n);
    expect(await decrypt(grant.refunded)).to.equal(500n);
    expect(await balance(treasury)).to.equal(10_000n);
    await expect(decrypt(grant.claimed, outsider)).to.be.rejected;
  });

  it("rejects funding proofs made for another wallet or contract", async function () {
    for (const [target, user] of [
      [address, outsider.address],
      [await token.getAddress(), treasury.address],
    ]) {
      const input = await fhevm.createEncryptedInput(target, user).add64(1000n).encrypt();
      await expect(
        vesting.createGrant(
          recipient.address,
          await token.getAddress(),
          start,
          end,
          0,
          true,
          input.handles[0],
          input.inputProof,
        ),
      ).to.be.reverted;
      await expect(vesting.getGrant(1)).to.be.revertedWithCustomError(vesting, "UnknownGrant");
    }
  });

  it("supports the maximum schedule duration and allocation together", async function () {
    const snapshot = await takeSnapshot();
    const initialBlock = await ethers.provider.getBlockNumber();
    try {
      start = 0;
      end = 281474976710655;
      token = await (
        await ethers.getContractFactory("GenericConfidentialToken")
      ).deploy("Maximum", "MAX", 18446744073709551615n);
      await token.setOperator(address, end);
      await create(18446744073709551615n);
      await time.setNextBlockTimestamp(end - 1);
      await vesting.connect(recipient).claim(1);
      expect(await balance(recipient)).to.equal(18446744073709486078n);
      await time.setNextBlockTimestamp(end);
      await vesting.connect(recipient).claim(1);
      expect(await balance(recipient)).to.equal(18446744073709551615n);
      await time.setNextBlockTimestamp(end + 1);
      await vesting.revoke(1);
      expect((await vesting.getGrant(1)).revokedAt).to.equal(281474976710656n);
      await vesting.connect(recipient).claim(1);
      expect(await decrypt((await vesting.getGrant(1)).claimed)).to.equal(18446744073709551615n);
    } finally {
      const blocks = (await ethers.provider.getBlockNumber()) - initialBlock;
      await snapshot.restore();
      // The mock coprocessor retains its scan cursor after a snapshot restore.
      await mine(blocks + 1);
    }
  });

  it("unlocks one quarter of a four-year grant at its one-year cliff", async function () {
    const year = 365 * 24 * 60 * 60;
    end = start + 4 * year;
    await create(1000n, treasury, recipient, token, start + year);
    await time.setNextBlockTimestamp(start + year - 1);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(0n);
    await time.setNextBlockTimestamp(start + year);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(250n);
  });

  it("runs the full local lifecycle through the feature deployment", async function () {
    await hre.deployments.run(["ConfidentialVesting"], { resetMemory: true, writeDeploymentsToFiles: false });
    const deployed = await hre.deployments.get("ConfidentialVesting");
    vesting = await ethers.getContractAt("ConfidentialVesting", deployed.address);
    address = deployed.address;
    const restricted = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Vesting Test Token", "VTT", 10_000n);
    token = restricted;
    await token.setOperator(address, end + 1000);
    await create();
    expect(await decrypt((await vesting.getGrant(1)).allocation, recipient)).to.equal(1000n);
    await time.setNextBlockTimestamp(start + 100);
    await vesting.connect(recipient).claim(1);
    await restricted.setTransferMode(treasury.address, 1);
    await time.setNextBlockTimestamp(start + 200);
    await vesting.revoke(1);
    expect(await decrypt((await vesting.getGrant(1)).refunded)).to.equal(0n);
    await restricted.setTransferMode(treasury.address, 0);
    await vesting.retryRefund(1);
    await time.setNextBlockTimestamp(end);
    await vesting.connect(recipient).claim(1);
    expect(await balance(recipient)).to.equal(500n);
    expect(await balance(treasury)).to.equal(9500n);
    expect(await decrypt((await vesting.getGrant(1)).refunded, recipient)).to.equal(500n);
  });

  it("records a funded grant that both parties can inspect privately", async function () {
    await expect(create())
      .to.emit(vesting, "GrantCreated")
      .withArgs(1n, treasury.address, recipient.address, await token.getAddress());
    const grant = await vesting.getGrant(1);
    expect(grant.treasury).to.equal(treasury.address);
    expect(grant.recipient).to.equal(recipient.address);
    expect(grant.token).to.equal(await token.getAddress());
    expect(grant.start).to.equal(start);
    expect(grant.end).to.equal(end);
    expect(await decrypt(grant.allocation)).to.equal(1000n);
    expect(await decrypt(grant.allocation, recipient)).to.equal(1000n);
    expect(await decrypt(grant.claimed)).to.equal(0n);
  });
});
