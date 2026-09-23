import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";

import { assertDeploymentTransaction } from "../../scripts/payroll/deployment/export";
import {
  DEFAULT_HARDHAT_DEPLOYER_ADDRESS,
  assertDeploymentConfirmation,
  assertNoExistingSepoliaDeployment,
  buildDeploymentConfirmation,
  runSepoliaPreflight,
  type DeploymentGasSettings,
  type ReadOnlyDeploymentProvider,
} from "../../scripts/payroll/deployment/preflight";
import {
  loadPayrollRuntimeArtifact,
  normalizeRuntimeBytecode,
  verifyRuntimeBytecode,
  writeDeploymentRecord,
  type DeploymentRecord,
  type RuntimeArtifact,
} from "../../scripts/payroll/deployment/provenance";

const expectedDeployerAddress = "0x0000000000000000000000000000000000000002";
const gasSettings: DeploymentGasSettings = { gasLimit: 120n, maxFeePerGas: 2n };

const artifact: RuntimeArtifact = {
  abi: [],
  bytecode: "0x6000",
  compiledSourceHash: "compiled-source",
  compilerInputHash: "compiler-input",
  compilerSettings: { optimizer: { enabled: true } },
  contractName: "ConfidentialMultisend",
  deployedBytecode: "0x12340000abcd",
  metadata: JSON.stringify({ compiler: { version: "0.8.27+commit.40a35a09" } }),
  sourceName: "contracts/payroll/ConfidentialMultisend.sol",
};

function provider(overrides: Partial<ReadOnlyDeploymentProvider> = {}): ReadOnlyDeploymentProvider {
  return {
    estimateGas: async () => 100n,
    getBalance: async () => 1_000n,
    getCode: async () => "0x6000",
    getFeeData: async () => ({ gasPrice: 2n, maxFeePerGas: null }),
    getNetwork: async () => ({ chainId: 11_155_111n }),
    getTransactionCount: async () => 7,
    ...overrides,
  };
}

function preflightOptions(overrides: Partial<Parameters<typeof runSepoliaPreflight>[0]> = {}) {
  return {
    artifact,
    expectedDeployer: expectedDeployerAddress,
    gasSettings,
    provider: provider(),
    signer: expectedDeployerAddress,
    ...overrides,
  };
}

describe("payroll deployment helpers", function () {
  it("uses read-only RPC methods to bind the confirmation to the pending deployment and gas caps", async function () {
    const calls: string[] = [];
    const result = await runSepoliaPreflight(
      preflightOptions({
        provider: provider({
          estimateGas: async () => {
            calls.push("estimateGas");
            return 100n;
          },
          getBalance: async () => {
            calls.push("getBalance");
            return 1_000n;
          },
          getCode: async () => {
            calls.push("getCode");
            return "0x6000";
          },
          getFeeData: async () => {
            calls.push("getFeeData");
            return { gasPrice: 2n, maxFeePerGas: null };
          },
          getNetwork: async () => {
            calls.push("getNetwork");
            return { chainId: 11_155_111n };
          },
          getTransactionCount: async () => {
            calls.push("getTransactionCount");
            return 7;
          },
        }),
      }),
    );

    expect(calls).to.deep.equal([
      "getNetwork",
      "getCode",
      "getFeeData",
      "estimateGas",
      "getBalance",
      "getTransactionCount",
    ]);
    expect(result.gasBudget).to.equal(240n);
    expect(result.confirmation).to.equal(
      buildDeploymentConfirmation({
        artifactHash: result.artifactHash,
        chainId: 11_155_111n,
        gasSettings,
        nonce: 7,
        signer: expectedDeployerAddress,
      }),
    );
  });

  it("quotes suggested gas caps without creating a deployment confirmation", async function () {
    const quote = await runSepoliaPreflight(preflightOptions({ gasSettings: undefined }));
    expect(quote.confirmation).to.equal(undefined);
    expect(quote.gasBudget).to.equal(undefined);
    expect(quote.suggestedGasSettings).to.deep.equal({ gasLimit: 120n, maxFeePerGas: 2n });
  });

  it("rejects unsafe deployment states before a broadcast", async function () {
    await expect(
      runSepoliaPreflight(preflightOptions({ signer: DEFAULT_HARDHAT_DEPLOYER_ADDRESS })),
    ).to.be.rejectedWith("known Hardhat default");
    await expect(
      runSepoliaPreflight(preflightOptions({ signer: "0x0000000000000000000000000000000000000001" })),
    ).to.be.rejectedWith("does not match EXPECTED_DEPLOYER_ADDRESS");
    await expect(
      runSepoliaPreflight(preflightOptions({ provider: provider({ getNetwork: async () => ({ chainId: 31_337n }) }) })),
    ).to.be.rejectedWith("requires Sepolia");
    await expect(
      runSepoliaPreflight(preflightOptions({ provider: provider({ getCode: async () => "0x" }) })),
    ).to.be.rejectedWith("mock token has no deployed code");
    await expect(
      runSepoliaPreflight(preflightOptions({ provider: provider({ getBalance: async () => 239n }) })),
    ).to.be.rejectedWith("below the deployment gas budget");
    await expect(
      runSepoliaPreflight(preflightOptions({ gasSettings: { gasLimit: 99n, maxFeePerGas: 2n } })),
    ).to.be.rejectedWith("GAS_LIMIT is below");
    await expect(
      runSepoliaPreflight(preflightOptions({ gasSettings: { gasLimit: 120n, maxFeePerGas: 1n } })),
    ).to.be.rejectedWith("MAX_FEE_PER_GAS_WEI is below");
  });

  it("refuses a Sepolia deploy rerun so verification preserves the original transaction provenance", function () {
    expect(() => assertNoExistingSepoliaDeployment(undefined)).not.to.throw();
    expect(() => assertNoExistingSepoliaDeployment("0x0000000000000000000000000000000000000003")).to.throw(
      "Run verify-deployment.ts instead",
    );
  });

  it("requires the exact confirmation for the observed nonce and gas caps", async function () {
    const confirmation = buildDeploymentConfirmation({
      artifactHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      chainId: 11_155_111n,
      gasSettings,
      nonce: 7,
      signer: expectedDeployerAddress,
    });
    assertDeploymentConfirmation(confirmation, confirmation);
    expect(() => assertDeploymentConfirmation(confirmation, `${confirmation}:stale`)).to.throw(
      "PAYROLL_DEPLOY_CONFIRMATION",
    );
  });

  it("checks exact runtime bytecode and rejects unverified immutable references", async function () {
    expect(verifyRuntimeBytecode(artifact, artifact.deployedBytecode).immutableReferenceCount).to.equal(0);
    expect(verifyRuntimeBytecode(artifact, "0x12340000ABCD").immutableReferenceCount).to.equal(0);
    expect(() => verifyRuntimeBytecode(artifact, "0x12340000dcba")).to.throw("does not match");
    const immutableArtifact = {
      ...artifact,
      immutableReferences: {
        "contracts/payroll/ConfidentialMultisend.sol": [{ length: 2, start: 2 }],
      },
    };
    expect(normalizeRuntimeBytecode("0x1234ffffabcd", immutableArtifact.immutableReferences)).to.equal(
      "0x12340000abcd",
    );
    expect(() => verifyRuntimeBytecode(immutableArtifact, "0x1234ffffabcd")).to.throw("immutable references");
  });

  it("checks the deployment receipt and creation transaction before export", function () {
    expect(() =>
      assertDeploymentTransaction({
        artifact,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: { blockNumber: 1, contractAddress: "0x0000000000000000000000000000000000000003", status: 1 },
        transaction: { data: artifact.bytecode, from: expectedDeployerAddress, nonce: 7, to: null },
      }),
    ).not.to.throw();
    expect(() =>
      assertDeploymentTransaction({
        artifact,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: { blockNumber: 1, contractAddress: "0x0000000000000000000000000000000000000003", status: 1 },
        transaction: { data: artifact.bytecode, from: expectedDeployerAddress, nonce: 7, to: expectedDeployerAddress },
      }),
    ).to.throw("contract creation");
  });

  it("writes public records once and rejects a differing overwrite", async function () {
    const directory = await mkdtemp(join(tmpdir(), "payroll-record-"));
    const record: DeploymentRecord = {
      abiFile: "ConfidentialMultisend.abi.json",
      artifact: {
        abiHash: "0x01",
        compiledSourceHash: "compiled",
        compilerInputHash: "input",
        creationBytecodeHash: "0x02",
        runtimeBytecodeHash: "0x03",
      },
      blockNumber: 1,
      chainId: "11155111",
      compiler: { settings: {}, version: "0.8.27" },
      configuration: {
        administrator: null,
        constructorArguments: [],
        dependencies: [],
        token: {
          address: "0x0000000000000000000000000000000000000004",
          codeHash: "0x04",
          compatibility: "code-presence-only",
        },
      },
      contractAddress: "0x0000000000000000000000000000000000000003",
      contractName: "ConfidentialMultisend",
      deployer: expectedDeployerAddress,
      gitCommit: "commit",
      nonce: 7,
      schemaVersion: 1,
      source: { currentHash: "current", matchesCompiledSource: false },
      sourceName: artifact.sourceName,
      transactionHash: "0x05",
      verifiedRuntime: {
        deployedRuntimeBytecodeHash: "0x06",
        immutableReferenceCount: 0,
        normalizedRuntimeBytecodeHash: "0x07",
      },
    };
    try {
      await writeDeploymentRecord({ abi: artifact.abi, directory, record });
      await writeDeploymentRecord({
        abi: artifact.abi,
        directory,
        record: {
          ...record,
          gitCommit: "new-commit",
          source: { currentHash: "new-current", matchesCompiledSource: true },
        },
      });
      expect(JSON.parse(await readFile(join(directory, "ConfidentialMultisend.abi.json"), "utf8"))).to.deep.equal([]);
      expect(JSON.parse(await readFile(join(directory, "deployment.json"), "utf8"))).to.deep.equal(record);
      await expect(writeDeploymentRecord({ abi: [{ type: "function" }], directory, record })).to.be.rejectedWith(
        "Existing deployment record differs",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("ConfidentialMultisend deployment tag", function () {
  it("deploys locally without Sepolia preflight or buyback deployments", async function () {
    const fixture = await deployments.fixture(["ConfidentialMultisend"]);
    const compiledArtifact = await loadPayrollRuntimeArtifact(hre);
    expect(fixture.ConfidentialMultisend.args).to.deep.equal([]);
    expect(fixture).not.to.have.property("BuybackVault");
    expect(await ethers.provider.getCode(fixture.ConfidentialMultisend.address)).not.to.equal("0x");
    expect(compiledArtifact.metadata).to.include("compiler");
    expect(compiledArtifact.compiledSourceHash).to.have.length(64);
  });
});
