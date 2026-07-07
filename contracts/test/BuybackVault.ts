import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { BuybackVault, ConfidentialGovToken, MockPriceOracle } from "../types";

const T = 10n ** 6n; // 1 token, 6 decimals
const INITIAL_SUPPLY = 1_000_000n * T;
const PRICE = 200n; // 2.00 cUSDT per cTOKEN (2-decimal fixed point)
const EPOCH_DURATION = 3600;
const DISCLOSURE_DELAY = 300;

/** payout = fill * price(2dp) / 100 */
const payoutOf = (fill: bigint, price: bigint) => (fill * price) / 100n;

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
  let oracle: MockPriceOracle;
  let vault: BuybackVault;
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

    const oracleFactory = await ethers.getContractFactory("MockPriceOracle");
    oracle = (await oracleFactory.connect(signers.treasury).deploy(PRICE)) as MockPriceOracle;

    const vaultFactory = await ethers.getContractFactory("BuybackVault");
    vault = (await vaultFactory
      .connect(signers.treasury)
      .deploy(
        await cToken.getAddress(),
        await cUsdt.getAddress(),
        await oracle.getAddress(),
        EPOCH_DURATION,
      )) as BuybackVault;
    vaultAddress = await vault.getAddress();

    // Treasury funds the vault with cUSDT (payment leg escrow).
    await confidentialTransfer(cUsdt, signers.treasury, vaultAddress, 500_000n * T);
  });

  async function encrypt64(contractAddress: string, user: HardhatEthersSigner, values: bigint[]) {
    const input = fhevm.createEncryptedInput(contractAddress, user.address);
    for (const v of values) input.add64(v);
    return input.encrypt();
  }

  async function confidentialTransfer(
    token: ConfidentialGovToken,
    from: HardhatEthersSigner,
    to: string,
    amount: bigint,
  ) {
    const enc = await encrypt64(await token.getAddress(), from, [amount]);
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

  async function openEpoch(budget: bigint) {
    const enc = await encrypt64(vaultAddress, signers.treasury, [budget]);
    await (await vault.connect(signers.treasury).openEpoch(enc.handles[0], enc.inputProof)).wait();
    return vault.currentEpochId();
  }

  /** Faucets cTOKEN, approves the vault as operator, submits an offer with a price floor. */
  async function submitOffer(seller: HardhatEthersSigner, amount: bigint, minPrice = 0n, faucetAmount?: bigint) {
    if (faucetAmount !== 0n) {
      await (await cToken.connect(seller).faucet(faucetAmount ?? amount)).wait();
    }
    const until = (await time.latest()) + 24 * 3600;
    await (await cToken.connect(seller).setOperator(vaultAddress, until)).wait();
    const enc = await encrypt64(vaultAddress, seller, [amount, minPrice]);
    await (await vault.connect(seller).submitOffer(enc.handles[0], enc.handles[1], enc.inputProof)).wait();
  }

  async function myFill(epochId: bigint, seller: HardhatEthersSigner): Promise<bigint> {
    return decrypt64(await vault.connect(seller).getMyFill(epochId), vaultAddress, seller);
  }

  async function myOffer(epochId: bigint, seller: HardhatEthersSigner): Promise<bigint> {
    return decrypt64(await vault.connect(seller).getMyOffer(epochId), vaultAddress, seller);
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

  const roll = () => vault.connect(signers.treasury).rollEpoch();

  describe("windows", function () {
    it("opens the pool; treasury can decrypt budget, remaining and totalFilled", async function () {
      const epochId = await openEpoch(1_000n * T);
      const state = await epochState(epochId);
      expect(state.budget).to.eq(1_000n * T);
      expect(state.remaining).to.eq(1_000n * T);
      expect(state.totalFilled).to.eq(0n);
      expect(state.raw.open).to.eq(true);
      expect(state.raw.settlementPrice).to.eq(0n);
      expect(state.raw.endsAt - state.raw.openedAt).to.eq(BigInt(EPOCH_DURATION));
    });

    it("clamps the encrypted budget to MAX_BUDGET", async function () {
      const maxBudget = await vault.MAX_BUDGET();
      const epochId = await openEpoch(maxBudget + 1n);
      expect((await epochState(epochId)).budget).to.eq(maxBudget);
    });

    it("rolling settles at the oracle price and carries unspent budget over", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 300n * T);
      await (await oracle.connect(signers.treasury).setPrice(210n)).wait();
      await (await roll()).wait();

      const settled = await vault.getEpoch(epochId);
      expect(settled.open).to.eq(false);
      expect(settled.settlementPrice).to.eq(210n);

      const nextId = await vault.currentEpochId();
      expect(nextId).to.eq(epochId + 1n);
      const next = await epochState(nextId);
      expect(next.budget).to.eq(700n * T); // carryover
      expect(next.totalFilled).to.eq(0n);
      expect(await vault.hasOpenEpoch()).to.eq(true);
    });

    it("roll is owner-early or permissionless after expiry; oracle price must be set", async function () {
      await openEpoch(1_000n * T);
      await expect(vault.connect(signers.alice).rollEpoch()).to.be.revertedWith("vault: window not ended");

      await time.increase(EPOCH_DURATION + 1);
      await (await vault.connect(signers.alice).rollEpoch()).wait(); // anyone after expiry

      await (await oracle.connect(signers.treasury).setPrice(0n)).wait();
      await expect(roll()).to.be.revertedWith("vault: oracle price unset");
    });

    it("clamps an out-of-range oracle price to MAX_PRICE", async function () {
      const epochId = await openEpoch(1_000n * T);
      const maxPrice = await vault.MAX_PRICE();
      await (await oracle.connect(signers.treasury).setPrice(maxPrice + 1n)).wait();
      await (await roll()).wait();
      expect((await vault.getEpoch(epochId)).settlementPrice).to.eq(maxPrice);
    });

    it("submitting into an expired window auto-rolls it first", async function () {
      const epochId = await openEpoch(1_000n * T);
      await time.increase(EPOCH_DURATION + 1);
      await submitOffer(signers.alice, 100n * T);

      const newId = await vault.currentEpochId();
      expect(newId).to.eq(epochId + 1n);
      expect(await myFill(newId, signers.alice)).to.eq(100n * T); // offer landed in the fresh window
      expect((await vault.getEpoch(epochId)).open).to.eq(false);
    });

    it("topUp confidentially increases budget and remaining", async function () {
      const epochId = await openEpoch(1_000n * T);
      const enc = await encrypt64(vaultAddress, signers.treasury, [500n * T]);
      await (await vault.connect(signers.treasury).topUp(enc.handles[0], enc.inputProof)).wait();
      const state = await epochState(epochId);
      expect(state.budget).to.eq(1_500n * T);
      expect(state.remaining).to.eq(1_500n * T);
    });

    it("only owner can open, top up, and set duration; duration bounds enforced", async function () {
      const enc = await encrypt64(vaultAddress, signers.alice, [1n * T]);
      await expect(
        vault.connect(signers.alice).openEpoch(enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

      await openEpoch(1_000n * T);
      const enc2 = await encrypt64(vaultAddress, signers.alice, [1n * T]);
      await expect(vault.connect(signers.alice).topUp(enc2.handles[0], enc2.inputProof)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount",
      );
      await expect(vault.connect(signers.treasury).setEpochDuration(59)).to.be.revertedWith("vault: bad duration");

      const enc3 = await encrypt64(vaultAddress, signers.treasury, [1n * T]);
      await expect(
        vault.connect(signers.treasury).openEpoch(enc3.handles[0], enc3.inputProof),
      ).to.be.revertedWith("vault: epoch already open");
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
      await submitOffer(signers.alice, 1_500n * T, 0n, 1_500n * T);

      expect(await myFill(epochId, signers.alice)).to.eq(1_000n * T);
      expect((await epochState(epochId)).remaining).to.eq(0n);
    });

    it("two sellers FCFS, second partially filled, third gets zero fill", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 600n * T);
      await submitOffer(signers.bob, 700n * T);
      await submitOffer(signers.carol, 100n * T);

      expect(await myFill(epochId, signers.alice)).to.eq(600n * T);
      expect(await myFill(epochId, signers.bob)).to.eq(400n * T);
      expect(await myFill(epochId, signers.carol)).to.eq(0n);
      expect((await epochState(epochId)).totalFilled).to.eq(1_000n * T);
    });

    it("offer exceeding the seller's balance escrows 0 (all-or-nothing transfer)", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.carol, 100n * T, 0n, 50n * T); // balance 50 < offer 100

      expect(await myOffer(epochId, signers.carol)).to.eq(0n);
      expect(await myFill(epochId, signers.carol)).to.eq(0n);
      expect(await balanceOf(cToken, signers.carol)).to.eq(50n * T);
    });

    it("rejects a second offer from the same seller in the same window", async function () {
      await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 100n * T);
      const enc = await encrypt64(vaultAddress, signers.alice, [100n * T, 0n]);
      await expect(
        vault.connect(signers.alice).submitOffer(enc.handles[0], enc.handles[1], enc.inputProof),
      ).to.be.revertedWith("vault: already submitted");
    });

    it("rejects offers before the pool is opened", async function () {
      const enc = await encrypt64(vaultAddress, signers.alice, [100n * T, 0n]);
      await expect(
        vault.connect(signers.alice).submitOffer(enc.handles[0], enc.handles[1], enc.inputProof),
      ).to.be.revertedWith("vault: no open epoch");
    });
  });

  describe("claims", function () {
    it("floor met: pays fill * settlementPrice / 100 in cUSDT and refunds offer - fill", async function () {
      const epochId = await openEpoch(1_000n * T);
      // Alice offers 1500 with a 1.50 floor; budget 1000 -> fill 1000, refund 500.
      await submitOffer(signers.alice, 1_500n * T, 150n, 1_500n * T);
      await (await oracle.connect(signers.treasury).setPrice(210n)).wait();
      await (await roll()).wait();

      await (await vault.connect(signers.alice).claim(epochId)).wait();

      expect(await balanceOf(cUsdt, signers.alice)).to.eq(payoutOf(1_000n * T, 210n)); // 2100 cUSDT
      expect(await balanceOf(cToken, signers.alice)).to.eq(500n * T);
    });

    it("floor not met: zero payout, full refund, disclosed total backed out", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 300n * T, 250n); // floor 2.50 > settlement 2.00
      await submitOffer(signers.bob, 200n * T, 150n); // floor 1.50 met
      await (await roll()).wait();

      await (await vault.connect(signers.alice).claim(epochId)).wait();
      expect(await balanceOf(cUsdt, signers.alice)).to.eq(0n);
      expect(await balanceOf(cToken, signers.alice)).to.eq(300n * T); // full refund

      await (await vault.connect(signers.bob).claim(epochId)).wait();
      expect(await balanceOf(cUsdt, signers.bob)).to.eq(payoutOf(200n * T, PRICE));

      // totalFilled backed out from 500 to 200 after alice's floor failed.
      expect((await epochState(epochId)).totalFilled).to.eq(200n * T);
    });

    it("zero-floor offers always settle at the window price", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 400n * T); // min 0 = any price
      await (await oracle.connect(signers.treasury).setPrice(1n)).wait(); // 0.01 cUSDT
      await (await roll()).wait();

      await (await vault.connect(signers.alice).claim(epochId)).wait();
      expect(await balanceOf(cUsdt, signers.alice)).to.eq(payoutOf(400n * T, 1n)); // 4 cUSDT
    });

    it("rejects double claims, claims on the live window, and claims without an offer", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 100n * T);

      await expect(vault.connect(signers.alice).claim(epochId)).to.be.revertedWith("vault: window not settled");

      await (await roll()).wait();
      await expect(vault.connect(signers.bob).claim(epochId)).to.be.revertedWith("vault: no offer");

      await (await vault.connect(signers.alice).claim(epochId)).wait();
      await expect(vault.connect(signers.alice).claim(epochId)).to.be.revertedWith("vault: already claimed");

      await expect(vault.connect(signers.alice).claim(999)).to.be.revertedWith("vault: unknown epoch");
    });
  });

  describe("disclosure", function () {
    it("publicly discloses the settled window total after the delay (full KMS proof flow)", async function () {
      const epochId = await openEpoch(1_000n * T);
      await submitOffer(signers.alice, 400n * T);
      await (await roll()).wait();

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

    it("rejects disclosure of a live or unknown window", async function () {
      const epochId = await openEpoch(1_000n * T);
      await expect(vault.requestDisclosure(epochId)).to.be.revertedWith("vault: window not settled");
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
