import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { GenericConfidentialToken, ConfidentialMultisend } from "../../types";

describe("ConfidentialMultisend", function () {
  let sender: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;
  let token: GenericConfidentialToken;
  let multisend: ConfidentialMultisend;
  let scope: string;

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    [sender, alice, bob, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("GenericConfidentialToken")).deploy("Payroll token", "PAY", 1_000n);
    multisend = await (await ethers.getContractFactory("ConfidentialMultisend")).deploy();
    scope = await multisend.getAddress();
    await token.setOperator(scope, (await time.latest()) + 3_600);
  });

  async function encrypt(values: bigint[], user = sender, contract = scope) {
    const input = fhevm.createEncryptedInput(contract, user.address);
    for (const value of values) input.add64(value);
    return input.encrypt();
  }

  async function balance(
    user: HardhatEthersSigner,
    asset: Pick<GenericConfidentialToken, "confidentialBalanceOf" | "getAddress"> = token,
  ) {
    const handle = await asset.confidentialBalanceOf(user.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await asset.getAddress(), user);
  }

  it("rejects extra amounts instead of truncating them", async function () {
    const input = await encrypt([25n, 40n]);
    await expect(
      multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof),
    ).to.be.revertedWithCustomError(multisend, "MismatchedArrays");
    expect(await balance(sender)).to.equal(1_000n);
  });

  it("pays zero to every recipient when only part of the batch is affordable", async function () {
    const input = await encrypt([600n, 500n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    expect(await balance(sender)).to.equal(1_000n);
    expect(await balance(alice)).to.equal(0n);
    expect(await balance(bob)).to.equal(0n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const [index, user, requested] of [
      [0, alice, 600n],
      [1, bob, 500n],
    ] as const) {
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.requestedAmount, scope, user)).to.equal(
        requested,
      );
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.actualAmount, scope, user)).to.equal(0n);
    }
  });

  it("does not spend deposits when a maximal batch total wraps to zero or overflows repeatedly", async function () {
    await token.connect(outsider).faucet(2_000n);
    const deposit = await encrypt([2_000n], outsider, await token.getAddress());
    await token
      .connect(outsider)
      ["confidentialTransfer(address,bytes32,bytes)"](scope, deposit.handles[0], deposit.inputProof);
    const maximum = 18_446_744_073_709_551_615n;
    for (const values of [[maximum, 1n], Array<bigint>(10).fill(maximum)]) {
      const input = await encrypt(values);
      await multisend.multisend(
        await token.getAddress(),
        values.map(() => alice.address),
        input.handles,
        input.inputProof,
      );
      expect(await balance(sender)).to.equal(1_000n);
      expect(await balance(alice)).to.equal(0n);
    }
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    expect(logs).to.have.length(12);
    for (const log of logs)
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, log.args.actualAmount, scope, sender)).to.equal(0n);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[0].args.requestedAmount, scope, alice)).to.equal(
      maximum,
    );
  });

  it("pays the full uint64 maximum without clamping it", async function () {
    const maximum = 18_446_744_073_709_551_615n;
    const asset = await (
      await ethers.getContractFactory("GenericConfidentialToken")
    ).deploy("Maximum supply", "MAX", maximum);
    await asset.setOperator(scope, (await time.latest()) + 3_600);
    const input = await encrypt([maximum]);
    await multisend.multisend(await asset.getAddress(), [alice.address], input.handles, input.inputProof);
    expect(await balance(sender, asset)).to.equal(0n);
    expect(await balance(alice, asset)).to.equal(18_446_744_073_709_551_615n);
    const [log] = await multisend.queryFilter(multisend.filters.Payment());
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, log.args.actualAmount, scope, alice)).to.equal(
      18_446_744_073_709_551_615n,
    );
  });

  it("denies outsider decryption and does not disclose amounts or unrelated balances", async function () {
    const input = await encrypt([25n, 40n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const log of logs) {
      for (const field of ["requestedAmount", "actualAmount"] as const) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, log.args[field], scope, outsider)).to.be.rejectedWith(
          "not authorized",
        );
        await expect(fhevm.publicDecrypt([log.args[field]])).to.be.rejected;
      }
    }
    for (const holder of [alice.address, bob.address, scope]) {
      const handle = await token.confidentialBalanceOf(holder);
      await expect(
        fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), sender),
      ).to.be.rejectedWith("not authorized");
    }
  });

  it("supports verified handles and the SDK zero handle with an empty proof", async function () {
    const input = await encrypt([25n]);
    await multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof);
    const [first] = await multisend.queryFilter(multisend.filters.Payment());
    await multisend.multisend(
      await token.getAddress(),
      [bob.address, alice.address],
      [first.args.requestedAmount, ethers.ZeroHash],
      "0x",
    );
    expect(await balance(sender)).to.equal(950n);
    expect(await balance(alice)).to.equal(25n);
    expect(await balance(bob)).to.equal(25n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, logs[1].args.requestedAmount, scope, alice),
    ).to.be.rejectedWith("not authorized");
  });

  it("rejects malformed proofs and inputs bound to another caller, contract, or type", async function () {
    const valid = await encrypt([25n]);
    const wrongCaller = await encrypt([25n], outsider);
    const wrongContract = await encrypt([25n], sender, await token.getAddress());
    const wrongType = await fhevm.createEncryptedInput(scope, sender.address).add32(25).encrypt();
    const other = await encrypt([26n]);
    const invalidInputs = [
      { handles: valid.handles, inputProof: "0x1234" },
      wrongCaller,
      wrongContract,
      wrongType,
      { handles: other.handles, inputProof: valid.inputProof },
    ];
    for (const input of invalidInputs) {
      await expect(multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof)).to
        .be.reverted;
    }
    expect(await balance(sender)).to.equal(1_000n);
    expect(await balance(alice)).to.equal(0n);
    expect(await multisend.queryFilter(multisend.filters.Payment())).to.have.length(0);
  });

  it("accepts operator authorization at expiry and rejects it afterward", async function () {
    const until = (await time.latest()) + 20;
    await token.setOperator(scope, until);
    const input = await encrypt([25n]);
    await time.setNextBlockTimestamp(until);
    await multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof);
    expect(await balance(alice)).to.equal(25n);
    await time.increaseTo(until + 1);
    await expect(multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof))
      .to.be.revertedWithCustomError(token, "ERC7984UnauthorizedSpender")
      .withArgs(sender.address, scope);
    expect(await balance(sender)).to.equal(975n);
  });

  it("requires the caller's active operator permission", async function () {
    await token.setOperator(scope, 0);
    const input = await encrypt([25n]);
    await expect(multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof))
      .to.be.revertedWithCustomError(token, "ERC7984UnauthorizedSpender")
      .withArgs(sender.address, scope);
    expect(await balance(sender)).to.equal(1_000n);
  });

  it("treats repeated same-block calls as new payments without sharing recipient access", async function () {
    const input = await encrypt([25n]);
    const nonce = await sender.getNonce();
    await ethers.provider.send("evm_setAutomine", [false]);
    let first;
    let second;
    try {
      first = await multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof, {
        nonce,
        gasLimit: 8_000_000,
      });
      second = await multisend.multisend(await token.getAddress(), [bob.address], input.handles, input.inputProof, {
        nonce: nonce + 1,
        gasLimit: 8_000_000,
      });
      await ethers.provider.send("evm_mine", []);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    const firstReceipt = await first.wait();
    const secondReceipt = await second.wait();
    expect(firstReceipt?.blockNumber).to.equal(secondReceipt?.blockNumber);
    expect(await balance(sender)).to.equal(950n);
    expect(await balance(alice)).to.equal(25n);
    expect(await balance(bob)).to.equal(25n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    expect(logs).to.have.length(2);
    for (const field of ["requestedAmount", "actualAmount"] as const) {
      expect(logs[0].args[field]).not.to.equal(logs[1].args[field]);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, logs[0].args[field], scope, bob)).to.be.rejectedWith(
        "not authorized",
      );
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, logs[1].args[field], scope, alice)).to.be.rejectedWith(
        "not authorized",
      );
    }
  });

  it("treats repeated recipients and zero amounts as separate valid entries", async function () {
    const input = await encrypt([0n, 25n, 0n, 40n]);
    await multisend.multisend(
      await token.getAddress(),
      [alice.address, alice.address, bob.address, alice.address],
      input.handles,
      input.inputProof,
    );
    expect(await balance(sender)).to.equal(935n);
    expect(await balance(alice)).to.equal(65n);
    expect(await balance(bob)).to.equal(0n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    expect(logs).to.have.length(4);
    for (const [index, expected] of [0n, 25n, 0n, 40n].entries()) {
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.requestedAmount, scope, sender)).to.equal(
        expected,
      );
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.actualAmount, scope, sender)).to.equal(
        expected,
      );
    }
  });

  it("isolates callers and two distinct standard tokens", async function () {
    const other = await (
      await ethers.getContractFactory("GenericConfidentialToken", outsider)
    ).deploy("Other token", "OTHER", 1_000n);
    await other.connect(outsider).setOperator(scope, (await time.latest()) + 3_600);
    await token.connect(outsider).setOperator(scope, (await time.latest()) + 3_600);
    const first = await encrypt([25n]);
    await multisend.multisend(await token.getAddress(), [alice.address], first.handles, first.inputProof);
    const unpaid = await encrypt([40n], outsider);
    await multisend
      .connect(outsider)
      .multisend(await token.getAddress(), [bob.address], unpaid.handles, unpaid.inputProof);
    const second = await encrypt([7n], outsider);
    await multisend
      .connect(outsider)
      .multisend(await other.getAddress(), [bob.address], second.handles, second.inputProof);
    expect(await balance(sender)).to.equal(975n);
    expect(await balance(outsider)).to.equal(0n);
    expect(await balance(alice)).to.equal(25n);
    expect(await balance(bob)).to.equal(0n);
    expect(await balance(outsider, other)).to.equal(993n);
    expect(await balance(bob, other)).to.equal(7n);
    expect(await balance(alice, other)).to.equal(0n);
  });

  it("rejects the multisend and zero address as recipients", async function () {
    const input = await encrypt([25n]);
    for (const recipient of [scope, ethers.ZeroAddress]) {
      await expect(multisend.multisend(await token.getAddress(), [recipient], input.handles, input.inputProof))
        .to.be.revertedWithCustomError(multisend, "InvalidRecipient")
        .withArgs(recipient);
    }
    expect(await balance(sender)).to.equal(1_000n);
  });

  it("rejects mismatched recipient and amount arrays", async function () {
    const input = await encrypt([25n]);
    await expect(
      multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof),
    ).to.be.revertedWithCustomError(multisend, "MismatchedArrays");
  });

  it("rejects eleven entries before processing encrypted inputs", async function () {
    await expect(
      multisend.multisend(
        await token.getAddress(),
        Array(11).fill(alice.address),
        Array(11).fill(ethers.ZeroHash),
        "0x",
      ),
    )
      .to.be.revertedWithCustomError(multisend, "InvalidBatchSize")
      .withArgs(11);
  });

  it("rejects an empty batch", async function () {
    await expect(multisend.multisend(await token.getAddress(), [], [], "0x"))
      .to.be.revertedWithCustomError(multisend, "InvalidBatchSize")
      .withArgs(0);
  });

  it("pays zero and pulls zero when the encrypted total overflows", async function () {
    const input = await encrypt([18_446_744_073_709_551_615n, 2n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    expect(await balance(sender)).to.equal(1_000n);
    expect(await balance(alice)).to.equal(0n);
    expect(await balance(bob)).to.equal(0n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const log of logs)
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, log.args.actualAmount, scope, sender)).to.equal(0n);
  });

  it("does not use accidental deposits when the caller cannot fund the whole batch", async function () {
    await token.connect(outsider).faucet(2_000n);
    const deposit = await encrypt([2_000n], outsider, await token.getAddress());
    await token
      .connect(outsider)
      ["confidentialTransfer(address,bytes32,bytes)"](scope, deposit.handles[0], deposit.inputProof);
    const input = await encrypt([600n, 500n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    expect(await balance(sender)).to.equal(1_000n);
    expect(await balance(alice)).to.equal(0n);
    expect(await balance(bob)).to.equal(0n);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const log of logs)
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, log.args.actualAmount, scope, sender)).to.equal(0n);
  });

  it("pays ten entries within the local FHE and gas limits", async function () {
    const recipients = (await ethers.getSigners()).slice(1, 11);
    const input = await encrypt([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]);
    const receipt = await (
      await multisend.multisend(
        await token.getAddress(),
        recipients.map((user) => user.address),
        input.handles,
        input.inputProof,
      )
    ).wait();
    if (!receipt) throw new Error("Missing receipt");
    expect(await balance(sender)).to.equal(945n);
    for (const [index, user] of recipients.entries()) expect(await balance(user)).to.equal(BigInt(index + 1));
    const hcu = fhevm.computeTransactionHCU(receipt);
    expect(hcu.globalHCU).to.be.lessThan(20_000_000);
    expect(hcu.maxHCUDepth).to.be.lessThan(5_000_000);
    expect(receipt.gasUsed).to.be.lessThan(16_777_216n);
    console.info("ten-entry budget", {
      globalHCU: hcu.globalHCU,
      maxHCUDepth: hcu.maxHCUDepth,
      gasUsed: receipt.gasUsed.toString(),
    });
  });

  it("keeps repeated input handles private to each recipient", async function () {
    const input = await encrypt([25n]);
    await multisend.multisend(
      await token.getAddress(),
      [alice.address, bob.address],
      [input.handles[0], input.handles[0]],
      input.inputProof,
    );
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const field of ["requestedAmount", "actualAmount"] as const) {
      expect(logs[0].args[field]).not.to.equal(logs[1].args[field]);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, logs[0].args[field], scope, bob)).to.be.rejectedWith(
        "not authorized",
      );
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, logs[1].args[field], scope, alice)).to.be.rejectedWith(
        "not authorized",
      );
    }
  });

  it("lets each recipient decrypt their requested and actual amount", async function () {
    const input = await encrypt([25n, 40n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    for (const [index, user, expected] of [
      [0, alice, 25n],
      [1, bob, 40n],
    ] as const) {
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.requestedAmount, scope, user)).to.equal(
        expected,
      );
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, logs[index].args.actualAmount, scope, user)).to.equal(
        expected,
      );
    }
  });

  it("logs the sender, token, recipient, and sender-readable requested and actual amounts", async function () {
    const input = await encrypt([25n]);
    await multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof);
    const logs = await multisend.queryFilter(multisend.filters.Payment());
    expect(logs).to.have.length(1);
    const payment = logs[0].args;
    expect([payment.sender, payment.token, payment.recipient]).to.deep.equal([
      sender.address,
      await token.getAddress(),
      alice.address,
    ]);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, payment.requestedAmount, scope, sender)).to.equal(25n);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, payment.actualAmount, scope, sender)).to.equal(25n);
  });

  it("pays each entry in a batch", async function () {
    const input = await encrypt([25n, 40n]);
    await multisend.multisend(await token.getAddress(), [alice.address, bob.address], input.handles, input.inputProof);
    expect(await balance(sender)).to.equal(935n);
    expect(await balance(alice)).to.equal(25n);
    expect(await balance(bob)).to.equal(40n);
  });

  it("pays one recipient from the caller's funds", async function () {
    const input = await encrypt([25n]);
    await multisend.multisend(await token.getAddress(), [alice.address], input.handles, input.inputProof);
    expect(await balance(sender)).to.equal(975n);
    expect(await balance(alice)).to.equal(25n);
  });
});
