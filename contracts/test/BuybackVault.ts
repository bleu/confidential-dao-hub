import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { BuybackVault, ConfidentialGovToken } from "../types";

const T = 10n ** 6n; // 1 token, 6 decimals
const INITIAL_SUPPLY = 1_000_000n * T;
const PRICE = 2n; // 2 cUSDT base units per cTOKEN base unit (i.e. 2 cUSDT per cTOKEN)
const DISCLOSURE_DELAY = 300;

type Signers = {
  treasury: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
};

describe("BuybackVault", function () {
  let signers: Signers;
  let cToken: ConfidentialGovToken;
  let cUsdt: ConfidentialGovToken;
  let vault: BuybackVault;
  let cTokenAddress: string;
  let cUsdtAddress: string;
  let vaultAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = { treasury: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], carol: ethSigners[3] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite runs only against the FHEVM mock environment");
      this.skip();
    }

    const tokenFactory = await ethers.getContractFactory("ConfidentialGovToken");
    cToken = (await tokenFactory
      .connect(signers.treasury)
      .deploy("Confidential Governance Token", "cTOKEN", INITIAL_SUPPLY)) as ConfidentialGovToken;
    cUsdt = (await tokenFactory
      .connect(signers.treasury)
      .deploy("Confidential USDT (Mock)", "cUSDT", INITIAL_SUPPLY)) as ConfidentialGovToken;
    cTokenAddress = await cToken.getAddress();
    cUsdtAddress = await cUsdt.getAddress();

    const vaultFactory = await ethers.getContractFactory("BuybackVault");
    vault = (await vaultFactory.connect(signers.treasury).deploy(cTokenAddress, cUsdtAddress)) as BuybackVault;
    vaultAddress = await vault.getAddress();

    // Treasury funds the vault with cUSDT (payment leg escrow).
    await confidentialTransfer(cUsdt, signers.treasury, vaultAddress, 500_000n * T);
  });

  async function encrypt64(contractAddress: string, user: HardhatEthersSigner, value: bigint) {
    return fhevm.createEncryptedInput(contractAddress, user.address).add64(value).encrypt();
  }

  async function confidentialTransfer(
    token: ConfidentialGovToken,
    from: HardhatEthersSigner,
    to: string,
    amount: bigint,
  ) {
    const enc = await encrypt64(await token.getAddress(), from, amount);
    const tx = await token
      .connect(from)
      ["confidentialTransfer(address,bytes32,bytes)"](to, enc.handles[0], enc.inputProof);
    await tx.wait();
  }

  async function decrypt64(handle: string, contractAddress: string, user: HardhatEthersSigner): Promise<bigint> {
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, user);
  }

  async function balanceOf(token: ConfidentialGovToken, user: HardhatEthersSigner): Promise<bigint> {
    const handle = await token.confidentialBalanceOf(user.address);
    return decrypt64(handle, await token.getAddress(), user);
  }

  async function openEpoch(budget: bigint, price: bigint = PRICE) {
    const enc = await encrypt64(vaultAddress, signers.treasury, budget);
    const tx = await vault.connect(signers.treasury).openEpoch(enc.handles[0], enc.inputProof, price);
    await tx.wait();
    return vault.currentEpochId();
  }

  /** Faucets cTOKEN to the seller, approves the vault as operator, submits an offer. */
  async function submitOffer(seller: HardhatEthersSigner, amount: bigint, faucetAmount?: bigint) {
    if (faucetAmount !== 0n) {
      await (await cToken.connect(seller).faucet(faucetAmount ?? amount)).wait();
    }
    const until = (await time.latest()) + 3600;
    await (await cToken.connect(seller).setOperator(vaultAddress, until)).wait();
    const enc = await encrypt64(vaultAddress, seller, amount);
    await (await vault.connect(seller).submitOffer(enc.handles[0], enc.inputProof)).wait();
  }

  async function myFill(epochId: bigint, seller: HardhatEthersSigner): Promise<bigint> {
    const handle = await vault.connect(seller).getMyFill(epochId);
    return decrypt64(handle, vaultAddress, seller);
  }

  async function myOffer(epochId: bigint, seller: HardhatEthersSigner): Promise<bigint> {
    const handle = await vault.connect(seller).getMyOffer(epochId);
    return decrypt64(handle, vaultAddress, seller);
  }

  async function epochState(epochId: bigint) {
    const e = await vault.getEpoch(epochId);
    return {
      remaining: await decrypt64(e.remaining, vaultAddress, signers.treasury),
      totalFilled: await decrypt64(e.totalFilled, vaultAddress, signers.treasury),
      budget: await decrypt64(e.budget, vaultAddress, signers.treasury),
      raw: e,
    };
  }

  describe("epoch lifecycle", function () {
    it("opens an epoch; treasury can decrypt budget, remaining and totalFilled", async function () {
      const epochId = await openEpoch(1_000n * T);
      const state = await epochState(epochId);
      expect(state.budget).to.eq(1_000n * T);
      expect(state.remaining).to.eq(1_000n * T);
      expect(state.totalFilled).to.eq(0n);
      expect(state.raw.price).to.eq(PRICE);
      expect(state.raw.open).to.eq(true);
    });

    it("clamps the encrypted budget to MAX_BUDGET", async function () {
      const maxBudget = await vault.MAX_BUDGET();
      const epochId = await openEpoch(maxBudget + 1n);
      expect((await epochState(epochId)).budget).to.eq(maxBudget);
    });

    it("rejects a second concurrent epoch and invalid prices", async function () {
      await openEpoch(1_000n * T);
      const enc = await encrypt64(vaultAddress, signers.treasury, 1n * T);
      await expect(vault.connect(signers.treasury).openEpoch(enc.handles[0], enc.inputProof, PRICE)).to.be.revertedWith(
        "vault: epoch already open",
      );

      await (await vault.connect(signers.treasury).closeEpoch()).wait();
      const maxPrice = await vault.MAX_PRICE();
      const enc2 = await encrypt64(vaultAddress, signers.treasury, 1n * T);
      await expect(vault.connect(signers.treasury).openEpoch(enc2.handles[0], enc2.inputProof, 0)).to.be.revertedWith(
        "vault: invalid price",
      );
      await expect(
        vault.connect(signers.treasury).openEpoch(enc2.handles[0], enc2.inputProof, maxPrice + 1n),
      ).to.be.revertedWith("vault: invalid price");
    });

    it("only owner can open and close epochs", async function () {
      const enc = await encrypt64(vaultAddress, signers.alice, 1_000n * T);
      await expect(
        vault.connect(signers.alice).openEpoch(enc.handles[0], enc.inputProof, PRICE),
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

      await openEpoch(1_000n * T);
      await expect(vault.connect(signers.alice).closeEpoch()).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("offers", function () {
    it("offer smaller than budget: fill == offer, remaining decremented", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 400n * T);

      expect(await myOffer(epochId, signers.alice)).to.eq(400n * T);
      expect(await myFill(epochId, signers.alice)).to.eq(400n * T);
      const state = await epochState(epochId);
      expect(state.remaining).to.eq(600n * T);
      expect(state.totalFilled).to.eq(400n * T);
    });

    it("offer larger than remaining: fill == remaining", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 1_500n * T, 1_500n * T);

      expect(await myOffer(epochId, signers.alice)).to.eq(1_500n * T);
      expect(await myFill(epochId, signers.alice)).to.eq(1_000n * T);
      const state = await epochState(epochId);
      expect(state.remaining).to.eq(0n);
      expect(state.totalFilled).to.eq(1_000n * T);
    });

    it("two sellers FCFS, second partially filled, third gets zero fill", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 600n * T);
      await submitOffer(signers.bob, 700n * T);
      await submitOffer(signers.carol, 100n * T);

      expect(await myFill(epochId, signers.alice)).to.eq(600n * T);
      expect(await myFill(epochId, signers.bob)).to.eq(400n * T);
      expect(await myFill(epochId, signers.carol)).to.eq(0n);
      const state = await epochState(epochId);
      expect(state.remaining).to.eq(0n);
      expect(state.totalFilled).to.eq(1_000n * T);
    });

    it("offer exceeding the seller's balance escrows 0 (all-or-nothing transfer)", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.carol, 100n * T, 50n * T); // balance 50 < offer 100

      expect(await myOffer(epochId, signers.carol)).to.eq(0n);
      expect(await myFill(epochId, signers.carol)).to.eq(0n);
      expect(await balanceOf(cToken, signers.carol)).to.eq(50n * T);
      expect((await epochState(epochId)).remaining).to.eq(1_000n * T);
    });

    it("rejects a second offer from the same seller in the same epoch", async function () {
      await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 100n * T);
      const enc = await encrypt64(vaultAddress, signers.alice, 100n * T);
      await expect(vault.connect(signers.alice).submitOffer(enc.handles[0], enc.inputProof)).to.be.revertedWith(
        "vault: already submitted",
      );
    });

    it("rejects offers when no epoch is open or after close", async function () {
      const enc = await encrypt64(vaultAddress, signers.alice, 100n * T);
      await expect(vault.connect(signers.alice).submitOffer(enc.handles[0], enc.inputProof)).to.be.revertedWith(
        "vault: no open epoch",
      );

      await openEpoch(1_000n * T);
      await (await vault.connect(signers.treasury).closeEpoch()).wait();
      const enc2 = await encrypt64(vaultAddress, signers.alice, 100n * T);
      await expect(vault.connect(signers.alice).submitOffer(enc2.handles[0], enc2.inputProof)).to.be.revertedWith(
        "vault: no open epoch",
      );
    });
  });

  describe("claims", function () {
    it("pays fill * price in cUSDT and refunds offer - fill in cTOKEN", async function () {
      const epochId = await openEpoch(1_000n * T);
      // Alice offers 1500, budget 1000 -> fill 1000, refund 500.
      await submitOffer(signers.alice, 1_500n * T, 1_500n * T);
      await (await vault.connect(signers.treasury).closeEpoch()).wait();

      expect(await balanceOf(cUsdt, signers.alice)).to.eq(0n);
      expect(await balanceOf(cToken, signers.alice)).to.eq(0n);

      await (await vault.connect(signers.alice).claim(epochId)).wait();

      expect(await balanceOf(cUsdt, signers.alice)).to.eq(1_000n * T * PRICE);
      expect(await balanceOf(cToken, signers.alice)).to.eq(500n * T);
    });

    it("zero-fill seller gets full refund and zero payout", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 1_000n * T);
      await submitOffer(signers.carol, 100n * T);
      await (await vault.connect(signers.treasury).closeEpoch()).wait();

      await (await vault.connect(signers.carol).claim(epochId)).wait();
      expect(await balanceOf(cUsdt, signers.carol)).to.eq(0n);
      expect(await balanceOf(cToken, signers.carol)).to.eq(100n * T);
    });

    it("rejects double claims, claims while open, and claims without an offer", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 100n * T);

      await expect(vault.connect(signers.alice).claim(epochId)).to.be.revertedWith("vault: epoch still open");

      await (await vault.connect(signers.treasury).closeEpoch()).wait();
      await expect(vault.connect(signers.bob).claim(epochId)).to.be.revertedWith("vault: no offer");

      await (await vault.connect(signers.alice).claim(epochId)).wait();
      await expect(vault.connect(signers.alice).claim(epochId)).to.be.revertedWith("vault: already claimed");

      await expect(vault.connect(signers.alice).claim(999)).to.be.revertedWith("vault: unknown epoch");
    });
  });

  describe("disclosure", function () {
    it("publicly discloses the epoch total after the delay (full KMS proof flow)", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 400n * T);
      await (await vault.connect(signers.treasury).closeEpoch()).wait();

      await expect(vault.requestDisclosure(epochId)).to.be.revertedWith("vault: disclosure delay not elapsed");

      await time.increase(DISCLOSURE_DELAY + 1);
      await (await vault.requestDisclosure(epochId)).wait();

      const e = await vault.getEpoch(epochId);
      const results = await fhevm.publicDecrypt([e.totalFilled]);
      await (await vault.finalizeDisclosure(epochId, results.abiEncodedClearValues, results.decryptionProof)).wait();

      const disclosed = await vault.getEpoch(epochId);
      expect(disclosed.disclosed).to.eq(true);
      expect(disclosed.disclosedTotal).to.eq(400n * T);

      await expect(vault.requestDisclosure(epochId)).to.be.revertedWith("vault: already disclosed");
      await expect(
        vault.finalizeDisclosure(epochId, results.abiEncodedClearValues, results.decryptionProof),
      ).to.be.revertedWith("vault: already disclosed");
    });

    it("rejects disclosure of an open or unknown epoch", async function () {
      const epochId = await openEpoch(1_000n * T);
      await expect(vault.requestDisclosure(epochId)).to.be.revertedWith("vault: epoch not closed");
      await expect(vault.requestDisclosure(999)).to.be.revertedWith("vault: unknown epoch");
    });
  });

  describe("token", function () {
    it("faucet mints up to the cap and rejects above it", async function () {
      const cap = await cToken.FAUCET_CAP();
      await (await cToken.connect(signers.alice).faucet(cap)).wait();
      expect(await balanceOf(cToken, signers.alice)).to.eq(cap);
      await expect(cToken.connect(signers.alice).faucet(cap + 1n)).to.be.revertedWith("faucet: amount exceeds cap");
    });
  });
});
