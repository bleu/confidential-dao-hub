import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";

import { createFeatureDeployment } from "../../scripts/deployment/deploy";
import { safeCommandError } from "../../scripts/deployment/errors";
import { deploymentEnvironment, type DeploymentFeature } from "../../scripts/deployment/feature";
import { findDeploymentProgress, prepareFeature, verifyNewDeployment } from "../../scripts/deployment/preparation";
import { assertDeploymentTransaction } from "../../scripts/deployment/export";
import {
  DEFAULT_HARDHAT_DEPLOYER_ADDRESS,
  assertDeploymentConfirmation,
  buildDeploymentConfirmation,
  getDeploymentGasSettings,
  runSepoliaPreflight,
  type DeploymentGasSettings,
  type ReadOnlyDeploymentProvider,
} from "../../scripts/deployment/preflight";
import {
  assertSupportedArtifact,
  checkDeploymentRecord,
  deploymentRecordDirectory,
  getCreationData,
  loadRuntimeArtifact,
  normalizeRuntimeBytecode,
  verifyRuntimeBytecode,
  writeDeploymentRecord,
  type DeploymentRecord,
  type RuntimeArtifact,
} from "../../scripts/deployment/provenance";
import { buybacksDeployment } from "../../scripts/buybacks/deployment";
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
  contractName: "ConfidentialMultisend",
  deployedBytecode: "0x12340000abcd",
  immutableNames: {},
  metadata: JSON.stringify({ compiler: { version: "0.8.27+commit.40a35a09" } }),
  sourceName: "src/payroll/ConfidentialMultisend.sol",
};

const vestingArtifact: RuntimeArtifact = {
  ...payrollArtifact,
  contractName: "ConfidentialVesting",
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

function runnerHre(options: {
  deployments?: Record<string, { address: string; transactionHash?: string }>;
  getCode?: (address: string) => string;
  immutableAddressName?: string;
  newDeployment?: { address: string; newlyDeployed: boolean; transactionHash?: string };
  onDeploy?: (name: string, options: unknown) => void;
  receiptAddress?: string;
  transactionNonce?: number;
}) {
  const deployed = options.deployments ?? {};
  const sourceName = "src/payroll/ConfidentialMultisend.sol";
  const deployer = expectedDeployerAddress;
  const immutableReferences = options.immutableAddressName ? { "1": [{ length: 32, start: 0 }] } : undefined;
  const runtimeArtifact = (contractName: string) => ({
    abi: [],
    bytecode: "0x6000",
    contractName,
    deployedBytecode: immutableReferences ? `0x${"00".repeat(32)}` : "0x6000",
    linkReferences: {},
    sourceName,
  });

  return {
    artifacts: {
      getBuildInfo: async (qualifiedName: string) => {
        const contractName = qualifiedName.slice(qualifiedName.lastIndexOf(":") + 1);
        return {
          input: { settings: {}, sources: { [sourceName]: { content: "contract Test {}" } } },
          output: {
            contracts: {
              [sourceName]: {
                [contractName]: {
                  evm: { deployedBytecode: immutableReferences ? { immutableReferences } : {} },
                  metadata: '{"compiler":{"version":"0.8.27"}}',
                },
              },
            },
            sources: options.immutableAddressName
              ? {
                  [sourceName]: {
                    ast: {
                      id: 1,
                      mutability: "immutable",
                      name: options.immutableAddressName,
                      nodeType: "VariableDeclaration",
                      typeDescriptions: { typeString: "address" },
                    },
                  },
                }
              : {},
          },
        };
      },
      readArtifact: async (contractName: string) => runtimeArtifact(contractName),
    },
    config: { paths: { root: process.cwd() } },
    deployments: {
      deploy: async (name: string, deploymentOptions: unknown) => {
        options.onDeploy?.(name, deploymentOptions);
        if (options.newDeployment) return options.newDeployment;
        throw new Error("Deployment must not run in this test.");
      },
      getOrNull: async (name: string) => deployed[name] ?? null,
    },
    ethers: {
      provider: {
        estimateGas: async () => 100n,
        getBalance: async () => 1_000n,
        getCode: async (address: string) => options.getCode?.(address) ?? "0x6000",
        getFeeData: async () => ({ gasPrice: 2n, maxFeePerGas: null }),
        getNetwork: async () => ({ chainId: 11_155_111n }),
        getTransaction: async (transactionHash: string) => ({
          data: "0x6000",
          from: deployer,
          hash: transactionHash,
          nonce: options.transactionNonce ?? 7,
          to: null,
        }),
        getTransactionCount: async () => 7,
        getTransactionReceipt: async (transactionHash: string) => ({
          blockNumber: 1,
          contractAddress:
            options.receiptAddress ??
            Object.values(deployed).find((deployment) => deployment.transactionHash === transactionHash)?.address ??
            null,
          status: 1,
        }),
      },
    },
    getNamedAccounts: async () => ({ deployer }),
    network: { name: "sepolia" },
  };
}

function withEnvironment<T>(values: Record<string, string>, action: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return action().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
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

    expect(payrollConfirmation).to.match(/^payroll-deploy-v2:ConfidentialMultisend:default:/);
    expect(vestingConfirmation).to.match(/^vesting-deploy-v2:ConfidentialVesting:default:/);
    expect(payrollConfirmation).not.to.equal(vestingConfirmation);
    assertDeploymentConfirmation(payrollConfirmation, payrollConfirmation);
    expect(() => assertDeploymentConfirmation(payrollConfirmation, vestingConfirmation)).to.throw("confirmation");
  });

  it("binds the Sepolia approval to the selected contract, full creation data, and dependencies", async function () {
    const configuration = {
      administrator: expectedDeployerAddress,
      constructorArguments: [
        "0x0000000000000000000000000000000000000011",
        "0x0000000000000000000000000000000000000022",
        "0x0000000000000000000000000000000000000033",
        "900",
      ],
      dependencies: [
        {
          address: "0x0000000000000000000000000000000000000011",
          codeHash: "0x01",
          name: "ConfidentialGovToken",
        },
      ],
    };
    const original = await runSepoliaPreflight(
      preflightOptions(buybacksDeployment, {
        configuration,
        creationData: "0x60000001",
        deploymentName: "BuybackVault",
      }),
    );
    const changedArguments = await runSepoliaPreflight(
      preflightOptions(buybacksDeployment, {
        configuration: {
          ...configuration,
          constructorArguments: [...configuration.constructorArguments.slice(0, 3), "901"],
        },
        creationData: "0x60000002",
        deploymentName: "BuybackVault",
      }),
    );
    const changedDependency = await runSepoliaPreflight(
      preflightOptions(buybacksDeployment, {
        configuration: {
          ...configuration,
          dependencies: [
            {
              ...configuration.dependencies[0],
              address: "0x0000000000000000000000000000000000000044",
            },
          ],
        },
        creationData: "0x60000001",
        deploymentName: "BuybackVault",
      }),
    );

    expect(original.deploymentName).to.equal("BuybackVault");
    expect(original.creationDataHash).not.to.equal(changedArguments.creationDataHash);
    expect(original.confirmation).not.to.equal(changedArguments.confirmation);
    expect(original.confirmation).not.to.equal(changedDependency.confirmation);
    expect(() => assertDeploymentConfirmation(original.confirmation, changedArguments.confirmation!)).to.throw(
      "confirmation",
    );
    expect(() => assertDeploymentConfirmation(original.confirmation, changedDependency.confirmation!)).to.throw(
      "confirmation",
    );
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
        configuration: result.configuration,
        creationDataHash: result.creationDataHash,
        deploymentName: result.deploymentName,
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

  it("allows constructor and mapped immutable artifacts but rejects unsupported bytecode", function () {
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        abi: [{ inputs: [{ name: "owner", type: "address" }], type: "constructor" }],
      }),
    ).not.to.throw();
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        deployedBytecode: `0x${"00".repeat(32)}`,
        immutableNames: { "1": { name: "owner", type: "address" } },
        immutableReferences: {
          "1": [{ length: 32, start: 0 }],
        },
      }),
    ).not.to.throw();
    expect(() =>
      assertSupportedArtifact({
        ...payrollArtifact,
        linkReferences: {
          "src/Library.sol": { Library: [{ length: 20, start: 0 }] },
        },
      }),
    ).to.throw("linked libraries");
    expect(() => assertSupportedArtifact({ ...payrollArtifact, bytecode: "0x" })).to.throw("no creation bytecode");
    expect(() => assertSupportedArtifact({ ...payrollArtifact, bytecode: "0xnot-hex" })).to.throw("hexadecimal");
  });

  it("checks every mapped immutable runtime slot", function () {
    expect(verifyRuntimeBytecode(payrollArtifact, payrollArtifact.deployedBytecode).immutableReferenceCount).to.equal(
      0,
    );
    expect(verifyRuntimeBytecode(payrollArtifact, "0x12340000ABCD").immutableReferenceCount).to.equal(0);
    expect(() => verifyRuntimeBytecode(payrollArtifact, "0x12340000dcba")).to.throw("does not match");

    const cToken = "0x0000000000000000000000000000000000000011";
    const cUsdt = "0x0000000000000000000000000000000000000022";
    const oracle = "0x0000000000000000000000000000000000000033";
    const slot = (address: string) => `${"00".repeat(12)}${address.slice(2).toLowerCase()}`;
    const immutableArtifact: RuntimeArtifact = {
      ...payrollArtifact,
      deployedBytecode: `0x12${"00".repeat(128)}34`,
      immutableNames: {
        "1": { name: "CTOKEN", type: "contract IConfidentialToken" },
        "2": { name: "CUSDT", type: "contract IConfidentialToken" },
        "3": { name: "ORACLE", type: "contract IPriceOracle" },
      },
      immutableReferences: {
        "1": [
          { length: 32, start: 1 },
          { length: 32, start: 33 },
        ],
        "2": [{ length: 32, start: 65 }],
        "3": [{ length: 32, start: 97 }],
      },
    };
    const runtime = `0x12${slot(cToken)}${slot(cToken)}${slot(cUsdt)}${slot(oracle)}34`;
    const immutableAddresses = { CTOKEN: cToken, CUSDT: cUsdt, ORACLE: oracle };

    expect(verifyRuntimeBytecode(immutableArtifact, runtime, immutableAddresses).immutableReferenceCount).to.equal(4);
    expect(normalizeRuntimeBytecode(runtime, immutableArtifact.immutableReferences)).to.equal(
      immutableArtifact.deployedBytecode,
    );
    expect(() => verifyRuntimeBytecode(immutableArtifact, runtime, { CTOKEN: cToken, CUSDT: cUsdt })).to.throw(
      "ORACLE is missing",
    );
    expect(() =>
      verifyRuntimeBytecode(immutableArtifact, runtime, { ...immutableAddresses, UNKNOWN: oracle }),
    ).to.throw("UNKNOWN does not match");
    expect(() => verifyRuntimeBytecode(immutableArtifact, runtime, { ...immutableAddresses, CTOKEN: cUsdt })).to.throw(
      "CTOKEN does not match",
    );
    expect(() =>
      verifyRuntimeBytecode(
        {
          ...immutableArtifact,
          immutableNames: { ...immutableArtifact.immutableNames, "3": { name: "UNKNOWN", type: "uint64" } },
        },
        runtime,
        immutableAddresses,
      ),
    ).to.throw("not an address or contract");
  });

  it("checks the deployment receipt and complete creation transaction before export", async function () {
    const creationData = await getCreationData(
      {
        abi: [{ inputs: [{ name: "duration", type: "uint64" }], stateMutability: "nonpayable", type: "constructor" }],
        bytecode: "0x6000",
      },
      [900n],
    );
    expect(creationData).to.equal(`0x6000${"0".repeat(61)}384`);
    expect(() =>
      assertDeploymentTransaction({
        creationData,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: {
          blockNumber: 1,
          contractAddress: "0x0000000000000000000000000000000000000003",
          status: 1,
        },
        transaction: {
          data: creationData,
          from: expectedDeployerAddress,
          nonce: 7,
          to: null,
        },
      }),
    ).not.to.throw();
    expect(() =>
      assertDeploymentTransaction({
        creationData,
        contractAddress: "0x0000000000000000000000000000000000000003",
        deployer: expectedDeployerAddress,
        nonce: 7,
        receipt: {
          blockNumber: 1,
          contractAddress: "0x0000000000000000000000000000000000000003",
          status: 1,
        },
        transaction: {
          data: "0x6000",
          from: expectedDeployerAddress,
          nonce: 7,
          to: null,
        },
      }),
    ).to.throw("creation data");
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
      await rm(payrollAbiPath);
      expect(
        await checkDeploymentRecord({ abi: payrollArtifact.abi, directory: payrollDirectory, record: payrollRecord }),
      ).to.equal(false);
      await writeDeploymentRecord({
        abi: payrollArtifact.abi,
        directory: payrollDirectory,
        record: payrollRecord,
      });
      expect(
        await checkDeploymentRecord({ abi: payrollArtifact.abi, directory: payrollDirectory, record: payrollRecord }),
      ).to.equal(true);
      await rm(payrollRecordPath);
      await expect(
        checkDeploymentRecord({
          abi: [{ type: "function" }],
          directory: payrollDirectory,
          record: payrollRecord,
        }),
      ).to.be.rejectedWith("Existing deployment record differs");
      await writeDeploymentRecord({
        abi: payrollArtifact.abi,
        directory: payrollDirectory,
        record: payrollRecord,
      });
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

describe("shared feature runner", function () {
  const runnerFeature: DeploymentFeature = {
    key: "runner-progress-test",
    tag: "RunnerProgressTest",
    deploymentId: "runner_progress_test",
    envPrefix: "RUNNER_PROGRESS_TEST",
    contracts: () => [
      { artifactName: "First", name: "First" },
      { artifactName: "Second", dependencies: ["First"], name: "Second" },
    ],
  };

  const runnerBroadcastFeature: DeploymentFeature = {
    key: "runner-broadcast-test",
    tag: "RunnerBroadcastTest",
    deploymentId: "runner_broadcast_test",
    envPrefix: "RUNNER_BROADCAST_TEST",
    contracts: () => [
      { artifactName: "First", name: "First" },
      { artifactName: "Second", dependencies: ["First"], name: "Second" },
    ],
  };

  it("reuses a verified Sepolia step and selects only the next missing contract", async function () {
    const hre = runnerHre({
      deployments: { First: { address: "0x0000000000000000000000000000000000000011", transactionHash: "0x01" } },
    });
    const prepared = await prepareFeature(hre as never, runnerFeature);
    const progress = await findDeploymentProgress({
      hre: hre as never,
      networkChainId: 11_155_111n,
      prepared,
      signer: expectedDeployerAddress,
    });

    expect(progress.complete).to.equal(false);
    expect(progress.addresses).to.deep.equal({ First: "0x0000000000000000000000000000000000000011" });
    expect(progress.pending?.contract.name).to.equal("Second");
    expect(progress.pendingIndex).to.equal(1);
  });

  it("refuses a mismatched or out-of-order saved Sepolia deployment instead of replacing it", async function () {
    const mismatchedHre = runnerHre({
      deployments: { First: { address: "0x0000000000000000000000000000000000000011", transactionHash: "0x01" } },
    });
    const mismatchedPrepared = await prepareFeature(mismatchedHre as never, runnerFeature);
    mismatchedHre.ethers.provider.getTransaction = async () => ({
      data: "0x6001",
      from: expectedDeployerAddress,
      hash: "0x01",
      nonce: 7,
      to: null,
    });
    await expect(
      findDeploymentProgress({
        hre: mismatchedHre as never,
        networkChainId: 11_155_111n,
        prepared: mismatchedPrepared,
        signer: expectedDeployerAddress,
      }),
    ).to.be.rejectedWith("expected creation data");

    const outOfOrderHre = runnerHre({
      deployments: { Second: { address: "0x0000000000000000000000000000000000000022", transactionHash: "0x02" } },
    });
    const outOfOrderPrepared = await prepareFeature(outOfOrderHre as never, runnerFeature);
    await expect(
      findDeploymentProgress({
        hre: outOfOrderHre as never,
        networkChainId: 11_155_111n,
        prepared: outOfOrderPrepared,
        signer: expectedDeployerAddress,
      }),
    ).to.be.rejectedWith("Refusing replacement");
  });

  it("broadcasts only the approved pending Sepolia contract", async function () {
    const address = "0x0000000000000000000000000000000000000011";
    const directory = deploymentRecordDirectory(process.cwd(), runnerBroadcastFeature);
    const broadcasts: [string, unknown][] = [];
    const hre = runnerHre({
      newDeployment: { address, newlyDeployed: true, transactionHash: "0x01" },
      onDeploy: (name, options) => broadcasts.push([name, options]),
      receiptAddress: address,
    });
    const configuration = { administrator: null, constructorArguments: [], dependencies: [] };
    const approval = await runSepoliaPreflight({
      artifact: payrollArtifact,
      configuration,
      creationData: "0x6000",
      deploymentName: "First",
      expectedDeployer: expectedDeployerAddress,
      feature: runnerBroadcastFeature,
      gasSettings,
      provider: hre.ethers.provider as never,
      signer: expectedDeployerAddress,
    });
    const environment = deploymentEnvironment(runnerBroadcastFeature);

    await rm(directory, { force: true, recursive: true });
    try {
      await withEnvironment(
        {
          EXPECTED_DEPLOYER_ADDRESS: expectedDeployerAddress,
          [environment.confirmation]: approval.confirmation!,
          [environment.gasLimit]: gasSettings.gasLimit.toString(),
          [environment.maxFeePerGas]: gasSettings.maxFeePerGas.toString(),
        },
        async () => {
          expect(await createFeatureDeployment(runnerBroadcastFeature)(hre as never)).to.equal(undefined);
        },
      );
      expect(broadcasts).to.have.length(1);
      expect(broadcasts[0][0]).to.equal("First");
      expect(broadcasts[0][1]).to.deep.include({
        args: [],
        from: expectedDeployerAddress,
        gasLimit: "120",
        maxFeePerGas: "2",
        nonce: 7,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a stale Sepolia confirmation before any broadcast", async function () {
    const broadcasts: string[] = [];
    const hre = runnerHre({
      onDeploy: (name) => broadcasts.push(name),
    });
    const environment = deploymentEnvironment(runnerBroadcastFeature);

    await withEnvironment(
      {
        EXPECTED_DEPLOYER_ADDRESS: expectedDeployerAddress,
        [environment.confirmation]: "stale-confirmation",
        [environment.gasLimit]: gasSettings.gasLimit.toString(),
        [environment.maxFeePerGas]: gasSettings.maxFeePerGas.toString(),
      },
      async () => {
        await expect(createFeatureDeployment(runnerBroadcastFeature)(hre as never)).to.be.rejectedWith("confirmation");
      },
    );
    expect(broadcasts).to.deep.equal([]);
  });

  it("does not write a record when a new Sepolia transaction has the wrong approved nonce", async function () {
    const address = "0x0000000000000000000000000000000000000011";
    const directory = deploymentRecordDirectory(process.cwd(), runnerFeature, "First");
    const hre = runnerHre({ receiptAddress: address, transactionNonce: 8 });

    await rm(directory, { force: true, recursive: true });
    try {
      const prepared = await prepareFeature(hre as never, runnerFeature);
      const progress = await findDeploymentProgress({
        hre: hre as never,
        networkChainId: 11_155_111n,
        prepared,
        signer: expectedDeployerAddress,
      });
      expect(progress.pending?.contract.name).to.equal("First");
      await expect(
        verifyNewDeployment({
          deployment: { address, transactionHash: "0x01" },
          expectedNonce: 7,
          hre: hre as never,
          networkChainId: 11_155_111n,
          prepared,
          signer: expectedDeployerAddress,
          step: progress.pending!,
        }),
      ).to.be.rejectedWith("signer or nonce");
      await expect(readFile(join(directory, "deployment.json"), "utf8")).to.be.rejectedWith("ENOENT");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a missing immutable address before a Sepolia broadcast", async function () {
    const immutableFeature: DeploymentFeature = {
      key: "runner-immutable-test",
      tag: "RunnerImmutableTest",
      deploymentId: "runner_immutable_test",
      envPrefix: "RUNNER_IMMUTABLE_TEST",
      contracts: () => [
        {
          artifactName: "ImmutableContract",
          immutableAddresses: () => ({}),
          name: "ImmutableContract",
        },
      ],
    };
    let deployments = 0;
    const hre = runnerHre({
      immutableAddressName: "TOKEN",
      onDeploy: () => {
        deployments += 1;
      },
    });

    await expect(createFeatureDeployment(immutableFeature)(hre as never)).to.be.rejectedWith("TOKEN is missing");
    expect(deployments).to.equal(0);
  });

  it("checks an external cUSDT contract before the buyback runner can deploy", async function () {
    const previousCUsdtAddress = process.env.CUSDT_ADDRESS;
    process.env.CUSDT_ADDRESS = "0x0000000000000000000000000000000000000011";
    let deployments = 0;
    const hre = runnerHre({
      getCode: () => "0x",
      onDeploy: () => {
        deployments += 1;
      },
    });

    try {
      await expect(createFeatureDeployment(buybacksDeployment)(hre as never)).to.be.rejectedWith(
        "has no deployed code",
      );
      expect(deployments).to.equal(0);
    } finally {
      if (previousCUsdtAddress === undefined) delete process.env.CUSDT_ADDRESS;
      else process.env.CUSDT_ADDRESS = previousCUsdtAddress;
    }
  });
});

describe("buyback deployment descriptors", function () {
  it("keeps the original buyback tag, ID, defaults, and mock token mode", function () {
    const contracts = buybacksDeployment.contracts({});

    expect(buybacksDeployment.tag).to.equal("ConfidentialBuybacks");
    expect(buybacksDeployment.deploymentId).to.equal("deploy_confidential_buybacks_v2");
    expect(contracts.map(({ name }) => name)).to.deep.equal([
      "ConfidentialGovToken",
      "ConfidentialUSDT",
      "MockPriceOracle",
      "BuybackVault",
    ]);
    expect(contracts[0].args?.({})).to.deep.equal(["Confidential Governance Token", "cTOKEN", 1_000_000_000_000n]);
    expect(contracts[1].args?.({})).to.deep.equal(["Confidential USDT (Mock)", "cUSDT", 1_000_000_000_000n]);
    expect(contracts[1].externalAddress).to.equal(undefined);
    expect(contracts[2].args?.({})).to.deep.equal([200n]);
    expect(
      contracts[3].args?.({
        ConfidentialGovToken: "0x0000000000000000000000000000000000000011",
        ConfidentialUSDT: "0x0000000000000000000000000000000000000022",
        MockPriceOracle: "0x0000000000000000000000000000000000000033",
      }),
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000011",
      "0x0000000000000000000000000000000000000022",
      "0x0000000000000000000000000000000000000033",
      900n,
    ]);
  });

  it("accepts an external cUSDT address without replacing its deployment descriptor", function () {
    const [govToken, cUsdt, oracle, vault] = buybacksDeployment.contracts({
      CUSDT_ADDRESS: "0x0000000000000000000000000000000000000022",
      EPOCH_DURATION: "901",
      ORACLE_PRICE: "201",
    });

    expect(govToken.name).to.equal("ConfidentialGovToken");
    expect(cUsdt).to.include({
      artifactName: "ConfidentialGovToken",
      externalAddress: "0x0000000000000000000000000000000000000022",
    });
    expect(oracle.args?.({})).to.deep.equal([201n]);
    expect(
      vault.args?.({
        ConfidentialGovToken: "0x0000000000000000000000000000000000000011",
        ConfidentialUSDT: cUsdt.externalAddress!,
        MockPriceOracle: "0x0000000000000000000000000000000000000033",
      }),
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000011",
      "0x0000000000000000000000000000000000000022",
      "0x0000000000000000000000000000000000000033",
      901n,
    ]);
  });
});

describe("shared local deployment tags", function () {
  it("keeps all feature deployment IDs and tags isolated", function () {
    const payroll = createFeatureDeployment(payrollDeployment);
    const vesting = createFeatureDeployment(vestingDeployment);
    const buybacks = createFeatureDeployment(buybacksDeployment);

    expect(payroll.id).to.equal(payrollDeployment.deploymentId);
    expect(payroll.tags).to.deep.equal([payrollDeployment.tag]);
    expect(vesting.id).to.equal(vestingDeployment.deploymentId);
    expect(vesting.tags).to.deep.equal([vestingDeployment.tag]);
    expect(buybacks.id).to.equal(buybacksDeployment.deploymentId);
    expect(buybacks.tags).to.deep.equal([buybacksDeployment.tag]);
  });

  it("deploys each feature locally without the other feature deployments", async function () {
    const payrollFixture = await deployments.fixture([payrollDeployment.tag]);
    const vestingFixture = await deployments.fixture([vestingDeployment.tag]);
    const buybacksFixture = await deployments.fixture([buybacksDeployment.tag]);
    const payrollRuntimeArtifact = await loadRuntimeArtifact(hre, "ConfidentialMultisend");
    const vestingRuntimeArtifact = await loadRuntimeArtifact(hre, "ConfidentialVesting");

    expect(payrollFixture.ConfidentialMultisend.args).to.deep.equal([]);
    expect(payrollFixture).not.to.have.property("ConfidentialVesting");
    expect(payrollFixture).not.to.have.property("BuybackVault");
    expect(vestingFixture.ConfidentialVesting.args).to.deep.equal([]);
    expect(vestingFixture).not.to.have.property("ConfidentialMultisend");
    expect(vestingFixture).not.to.have.property("BuybackVault");
    expect(buybacksFixture.ConfidentialGovToken.args).to.deep.equal([
      "Confidential Governance Token",
      "cTOKEN",
      "1000000000000",
    ]);
    expect(buybacksFixture.ConfidentialUSDT.args).to.deep.equal(["Confidential USDT (Mock)", "cUSDT", "1000000000000"]);
    expect(buybacksFixture.MockPriceOracle.args).to.deep.equal(["200"]);
    expect(buybacksFixture.BuybackVault.args).to.have.length(4);
    expect(buybacksFixture).not.to.have.property("ConfidentialMultisend");
    expect(buybacksFixture).not.to.have.property("ConfidentialVesting");
    expect(await ethers.provider.getCode(payrollFixture.ConfidentialMultisend.address)).not.to.equal("0x");
    expect(await ethers.provider.getCode(vestingFixture.ConfidentialVesting.address)).not.to.equal("0x");
    expect(await ethers.provider.getCode(buybacksFixture.BuybackVault.address)).not.to.equal("0x");
    expect(payrollRuntimeArtifact.sourceName).to.equal("src/payroll/ConfidentialMultisend.sol");
    expect(vestingRuntimeArtifact.sourceName).to.equal("src/vesting/ConfidentialVesting.sol");
    expect(payrollRuntimeArtifact.metadata).to.include("compiler");
    expect(vestingRuntimeArtifact.metadata).to.include("compiler");
    expect(payrollRuntimeArtifact.compiledSourceHash).to.have.length(64);
    expect(vestingRuntimeArtifact.compiledSourceHash).to.have.length(64);
  });
});
