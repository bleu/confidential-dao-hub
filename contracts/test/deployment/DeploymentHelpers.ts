import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";

import { createFeatureDeployment } from "../../scripts/deployment/deploy";
import { safeCommandError } from "../../scripts/deployment/errors";
import { deploymentEnvironment } from "../../scripts/deployment/feature";
import { assertDeploymentTransaction } from "../../scripts/deployment/export";
import {
  DEFAULT_HARDHAT_DEPLOYER_ADDRESS,
  assertDeploymentConfirmation,
  assertNoExistingSepoliaDeployment,
  buildDeploymentConfirmation,
  getDeploymentGasSettings,
  runSepoliaPreflight,
  type DeploymentGasSettings,
  type ReadOnlyDeploymentProvider,
} from "../../scripts/deployment/preflight";
import {
  assertSupportedArtifact,
  deploymentRecordDirectory,
  loadRuntimeArtifact,
  normalizeRuntimeBytecode,
  verifyRuntimeBytecode,
  writeDeploymentRecord,
  type DeploymentRecord,
  type RuntimeArtifact,
} from "../../scripts/deployment/provenance";
import { payrollDeployment, SEPOLIA_MOCK_TOKEN_ADDRESS } from "../../scripts/payroll/deployment";
import { vestingDeployment } from "../../scripts/vesting/deployment";

const expectedDeployerAddress = "0x0000000000000000000000000000000000000002";
const gasSettings: DeploymentGasSettings = { gasLimit: 120n, maxFeePerGas: 2n };

const payrollArtifact: RuntimeArtifact = {
  abi: [],
  bytecode: "0x6000",
  compiledSourceHash: "compiled-source",
  compilerInputHash: "compiler-input",
  compilerSettings: { optimizer: { enabled: true } },
  contractName: payrollDeployment.contractName,
  deployedBytecode: "0x12340000abcd",
  metadata: JSON.stringify({ compiler: { version: "0.8.27+commit.40a35a09" } }),
  sourceName: "src/payroll/ConfidentialMultisend.sol",
};

const vestingArtifact: RuntimeArtifact = {
  ...payrollArtifact,
  contractName: vestingDeployment.contractName,
  sourceName: "src/vesting/ConfidentialVesting.sol",
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

function preflightOptions(
  feature = payrollDeployment,
  overrides: Partial<Parameters<typeof runSepoliaPreflight>[0]> = {},
) {
  return {
    artifact: feature === payrollDeployment ? payrollArtifact : vestingArtifact,
    expectedDeployer: expectedDeployerAddress,
    feature,
    gasSettings,
    provider: provider(),
    signer: expectedDeployerAddress,
    ...overrides,
  };
}

function deploymentRecord(
  artifact: RuntimeArtifact,
  configuration: DeploymentRecord["configuration"],
): DeploymentRecord {
  return {
    abiFile: `${artifact.contractName}.abi.json`,
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
    configuration,
    contractAddress: "0x0000000000000000000000000000000000000003",
    contractName: artifact.contractName,
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
}

describe("shared deployment helpers", function () {
  it("keeps feature deployment environment and confirmation values separate", function () {
    expect(deploymentEnvironment(payrollDeployment)).to.deep.equal({
      confirmation: "PAYROLL_DEPLOY_CONFIRMATION",
      gasLimit: "PAYROLL_DEPLOY_GAS_LIMIT",
      maxFeePerGas: "PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI",
    });
    expect(deploymentEnvironment(vestingDeployment)).to.deep.equal({
      confirmation: "VESTING_DEPLOY_CONFIRMATION",
      gasLimit: "VESTING_DEPLOY_GAS_LIMIT",
      maxFeePerGas: "VESTING_DEPLOY_MAX_FEE_PER_GAS_WEI",
    });
    expect(
      getDeploymentGasSettings(payrollDeployment, {
        PAYROLL_DEPLOY_GAS_LIMIT: "120",
        PAYROLL_DEPLOY_MAX_FEE_PER_GAS_WEI: "2",
      }),
    ).to.deep.equal(gasSettings);
    expect(
      getDeploymentGasSettings(vestingDeployment, {
        VESTING_DEPLOY_GAS_LIMIT: "121",
        VESTING_DEPLOY_MAX_FEE_PER_GAS_WEI: "3",
      }),
    ).to.deep.equal({ gasLimit: 121n, maxFeePerGas: 3n });

    const commonConfirmationInput = {
      artifactHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      chainId: 11_155_111n,
      gasSettings,
      nonce: 7,
      signer: expectedDeployerAddress,
    };
    const payrollConfirmation = buildDeploymentConfirmation({
      ...commonConfirmationInput,
      feature: payrollDeployment,
    });
    const vestingConfirmation = buildDeploymentConfirmation({
      ...commonConfirmationInput,
      feature: vestingDeployment,
    });

    expect(payrollConfirmation).to.match(/^payroll-deploy-v1:/);
    expect(vestingConfirmation).to.match(/^vesting-deploy-v1:/);
    expect(payrollConfirmation).not.to.equal(vestingConfirmation);
    assertDeploymentConfirmation(payrollConfirmation, payrollConfirmation);
    expect(() => assertDeploymentConfirmation(payrollConfirmation, vestingConfirmation)).to.throw("confirmation");
  });

  it("uses read-only RPC methods to bind payroll confirmation and token configuration", async function () {
    const calls: string[] = [];
    const result = await runSepoliaPreflight(
      preflightOptions(payrollDeployment, {
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
    expect(result.configuration).to.deep.equal({
      administrator: null,
      constructorArguments: [],
      dependencies: [],
      token: {
        address: SEPOLIA_MOCK_TOKEN_ADDRESS,
        codeHash: "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
        compatibility: "code-presence-only",
      },
    });
    expect(result.gasBudget).to.equal(240n);
    expect(result.confirmation).to.equal(
      buildDeploymentConfirmation({
        artifactHash: result.artifactHash,
        chainId: 11_155_111n,
        feature: payrollDeployment,
        gasSettings,
        nonce: 7,
        signer: expectedDeployerAddress,
      }),
    );
  });

  it("preflights vesting without reading a token contract", async function () {
    const calls: string[] = [];
    const result = await runSepoliaPreflight(
      preflightOptions(vestingDeployment, {
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
            throw new Error("vesting preflight must not read token code");
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

    expect(calls).to.deep.equal(["getNetwork", "getFeeData", "estimateGas", "getBalance", "getTransactionCount"]);
    expect(result.configuration).to.deep.equal({
      administrator: null,
      constructorArguments: [],
      dependencies: [],
    });
  });

  it("quotes suggested gas caps without creating a deployment confirmation", async function () {
    const quote = await runSepoliaPreflight(preflightOptions(payrollDeployment, { gasSettings: undefined }));
    expect(quote.confirmation).to.equal(undefined);
    expect(quote.gasBudget).to.equal(undefined);
    expect(quote.suggestedGasSettings).to.deep.equal({
      gasLimit: 120n,
      maxFeePerGas: 2n,
    });
  });

  it("rejects unsafe deployment states before a broadcast", async function () {
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          signer: DEFAULT_HARDHAT_DEPLOYER_ADDRESS,
        }),
      ),
    ).to.be.rejectedWith("known Hardhat default");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          signer: "0x0000000000000000000000000000000000000001",
        }),
      ),
    ).to.be.rejectedWith("does not match EXPECTED_DEPLOYER_ADDRESS");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          provider: provider({
            getNetwork: async () => ({ chainId: 31_337n }),
          }),
        }),
      ),
    ).to.be.rejectedWith("requires Sepolia");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          provider: provider({ getCode: async () => "0x" }),
        }),
      ),
    ).to.be.rejectedWith("mock token has no deployed code");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          provider: provider({ getBalance: async () => 239n }),
        }),
      ),
    ).to.be.rejectedWith("below the deployment gas budget");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          gasSettings: { gasLimit: 99n, maxFeePerGas: 2n },
        }),
      ),
    ).to.be.rejectedWith("GAS_LIMIT is below");
    await expect(
      runSepoliaPreflight(
        preflightOptions(payrollDeployment, {
          gasSettings: { gasLimit: 120n, maxFeePerGas: 1n },
        }),
      ),
    ).to.be.rejectedWith("MAX_FEE_PER_GAS_WEI is below");
  });

  it("refuses a Sepolia deploy rerun so verification preserves the original transaction provenance", function () {
    expect(() => assertNoExistingSepoliaDeployment(undefined)).not.to.throw();
    expect(() => assertNoExistingSepoliaDeployment("0x0000000000000000000000000000000000000003")).to.throw(
      "Run verify-deployment.ts instead",
    );
  });

  it("rejects unsupported artifacts before deployment", function () {
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        abi: [{ inputs: [{ name: "owner", type: "address" }], type: "constructor" }],
      }),
    ).to.throw("without constructor arguments");
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        linkReferences: {
          "src/Library.sol": { Library: [{ length: 20, start: 0 }] },
        },
      }),
    ).to.throw("linked libraries");
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        immutableReferences: {
          "src/payroll/ConfidentialMultisend.sol": [{ length: 20, start: 0 }],
        },
      }),
    ).to.throw("immutable references");
    expect(() => assertSupportedArtifact({ ...payrollArtifact, bytecode: "0x" })).to.throw("no creation bytecode");
    expect(() => assertSupportedArtifact({ ...payrollArtifact, bytecode: "0xnot-hex" })).to.throw("hexadecimal");
  });

  it("checks exact runtime bytecode and rejects unverified immutable references", function () {
    expect(verifyRuntimeBytecode(payrollArtifact, payrollArtifact.deployedBytecode).immutableReferenceCount).to.equal(
      0,
    );
    expect(verifyRuntimeBytecode(payrollArtifact, "0x12340000ABCD").immutableReferenceCount).to.equal(0);
    expect(() => verifyRuntimeBytecode(payrollArtifact, "0x12340000dcba")).to.throw("does not match");
    const immutableArtifact = {
      ...payrollArtifact,
      immutableReferences: {
        "src/payroll/ConfidentialMultisend.sol": [{ length: 2, start: 2 }],
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
        artifact: payrollArtifact,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: {
          blockNumber: 1,
          contractAddress: "0x0000000000000000000000000000000000000003",
          status: 1,
        },
        transaction: {
          data: payrollArtifact.bytecode,
          from: expectedDeployerAddress,
          nonce: 7,
          to: null,
        },
      }),
    ).not.to.throw();
    expect(() =>
      assertDeploymentTransaction({
        artifact: payrollArtifact,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: {
          blockNumber: 1,
          contractAddress: "0x0000000000000000000000000000000000000003",
          status: 1,
        },
        transaction: {
          data: payrollArtifact.bytecode,
          from: expectedDeployerAddress,
          nonce: 7,
          to: expectedDeployerAddress,
        },
      }),
    ).to.throw("contract creation");
  });

  it("keeps feature records in separate historical directories and rejects an overwrite", async function () {
    const root = await mkdtemp(join(tmpdir(), "deployment-record-"));
    const payrollDirectory = deploymentRecordDirectory(root, payrollDeployment);
    const vestingDirectory = deploymentRecordDirectory(root, vestingDeployment);
    const payrollRecord = deploymentRecord(payrollArtifact, {
      administrator: null,
      constructorArguments: [],
      dependencies: [],
      token: {
        address: SEPOLIA_MOCK_TOKEN_ADDRESS,
        codeHash: "0x04",
        compatibility: "code-presence-only",
      },
    });
    const vestingRecord = deploymentRecord(vestingArtifact, {
      administrator: null,
      constructorArguments: [],
      dependencies: [],
    });

    try {
      expect(payrollDirectory).to.equal(join(root, "deployment-records", "payroll", "sepolia"));
      expect(vestingDirectory).to.equal(join(root, "deployment-records", "vesting", "sepolia"));
      await writeDeploymentRecord({
        abi: payrollArtifact.abi,
        directory: payrollDirectory,
        record: payrollRecord,
      });
      await writeDeploymentRecord({
        abi: vestingArtifact.abi,
        directory: vestingDirectory,
        record: vestingRecord,
      });
      await writeDeploymentRecord({
        abi: payrollArtifact.abi,
        directory: payrollDirectory,
        record: {
          ...payrollRecord,
          gitCommit: "new-commit",
          source: { currentHash: "new-current", matchesCompiledSource: true },
        },
      });
      const payrollAbiPath = join(payrollDirectory, payrollRecord.abiFile);
      const payrollRecordPath = join(payrollDirectory, "deployment.json");
      const [historicalAbi, historicalRecord] = await Promise.all([
        readFile(payrollAbiPath, "utf8"),
        readFile(payrollRecordPath, "utf8"),
      ]);
      expect(JSON.parse(historicalAbi)).to.deep.equal([]);
      expect(JSON.parse(await readFile(join(vestingDirectory, vestingRecord.abiFile), "utf8"))).to.deep.equal([]);
      expect(JSON.parse(historicalRecord)).to.deep.equal(payrollRecord);
      await expect(
        writeDeploymentRecord({
          abi: [{ type: "function" }],
          directory: payrollDirectory,
          record: payrollRecord,
        }),
      ).to.be.rejectedWith("Existing deployment record differs");
      await expect(
        writeDeploymentRecord({
          abi: payrollArtifact.abi,
          directory: payrollDirectory,
          record: {
            ...payrollRecord,
            artifact: { ...payrollRecord.artifact, compilerInputHash: "different-input" },
            sourceName: "src/payroll/HistoricalConfidentialMultisend.sol",
          },
        }),
      ).to.be.rejectedWith("Existing deployment record differs");
      expect(await readFile(payrollAbiPath, "utf8")).to.equal(historicalAbi);
      expect(await readFile(payrollRecordPath, "utf8")).to.equal(historicalRecord);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns the generic safe deployment error without exposing internal details", function () {
    expect(safeCommandError(new Error("0x0123456789abcdef"))).to.equal(
      "Deployment command failed. Review the local configuration and deployment state.",
    );
  });
});

describe("shared local deployment tags", function () {
  it("keeps feature deployment IDs and tags isolated", function () {
    const payroll = createFeatureDeployment(payrollDeployment);
    const vesting = createFeatureDeployment(vestingDeployment);

    expect(payroll.id).to.equal(payrollDeployment.deploymentId);
    expect(payroll.tags).to.deep.equal([payrollDeployment.contractName]);
    expect(vesting.id).to.equal(vestingDeployment.deploymentId);
    expect(vesting.tags).to.deep.equal([vestingDeployment.contractName]);
  });

  it("deploys each feature locally without the other feature or buyback deployments", async function () {
    const payrollFixture = await deployments.fixture([payrollDeployment.contractName]);
    const vestingFixture = await deployments.fixture([vestingDeployment.contractName]);
    const payrollRuntimeArtifact = await loadRuntimeArtifact(hre, payrollDeployment);
    const vestingRuntimeArtifact = await loadRuntimeArtifact(hre, vestingDeployment);

    expect(payrollFixture[payrollDeployment.contractName].args).to.deep.equal([]);
    expect(payrollFixture).not.to.have.property(vestingDeployment.contractName);
    expect(payrollFixture).not.to.have.property("BuybackVault");
    expect(vestingFixture[vestingDeployment.contractName].args).to.deep.equal([]);
    expect(vestingFixture).not.to.have.property(payrollDeployment.contractName);
    expect(vestingFixture).not.to.have.property("BuybackVault");
    expect(await ethers.provider.getCode(payrollFixture[payrollDeployment.contractName].address)).not.to.equal("0x");
    expect(await ethers.provider.getCode(vestingFixture[vestingDeployment.contractName].address)).not.to.equal("0x");
    expect(payrollRuntimeArtifact.sourceName).to.equal("src/payroll/ConfidentialMultisend.sol");
    expect(vestingRuntimeArtifact.sourceName).to.equal("src/vesting/ConfidentialVesting.sol");
    expect(payrollRuntimeArtifact.metadata).to.include("compiler");
    expect(vestingRuntimeArtifact.metadata).to.include("compiler");
    expect(payrollRuntimeArtifact.compiledSourceHash).to.have.length(64);
    expect(vestingRuntimeArtifact.compiledSourceHash).to.have.length(64);
  });
});
