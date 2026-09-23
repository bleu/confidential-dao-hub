import {
  ACL,
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
  type HandleContractPair,
} from "@zama-fhe/relayer-sdk/node";
import * as dotenv from "dotenv";
import {
  Contract,
  getAddress,
  HDNodeWallet,
  JsonRpcProvider,
  keccak256,
  type ContractTransactionResponse,
  type TransactionReceipt,
  Wallet,
  ZeroHash,
} from "ethers";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

// This script sends Sepolia transactions only after its exact consent check passes.

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDT_ADDRESS = "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA";
const FAUCET_CAP = 10_000n * 10n ** 6n;
const RECIPIENT_COUNT = 10;
const MIN_OPERATOR_SECONDS = 900;
const MAX_OPERATOR_SECONDS = 3_600;
const CONSENT = "I_AUTHORIZE_SEPOLIA_PAYROLL_DEMO_TRANSACTIONS_WITH_OPERATOR_GRANT_AND_REVOCATION";
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const tokenAbi = [
  "function FAUCET_CAP() view returns (uint64)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function faucet(uint64 amount)",
  "function setOperator(address operator, uint48 until)",
] as const;
const multisendAbi = [
  "function multisend(address token, address[] recipients, bytes32[] encryptedAmounts, bytes inputProof)",
  "event Payment(address indexed sender, address indexed token, address indexed recipient, bytes32 requestedAmount, bytes32 actualAmount)",
] as const;

type DemoWallets = {
  sender: Wallet;
  recipients: Wallet[];
  outsider: Wallet;
};

type JournalAction = {
  name: string;
  status: "pending" | "submitted" | "confirmed";
  hash?: string;
  blockNumber?: number;
  gasUsed?: string;
  paymentLogIndexes?: number[];
  verification?: "pass";
};

type JournalMetadata = {
  chainId: string;
  token: string;
  multisend: string;
  sender: string;
  recipients: string[];
};

type Journal = {
  version: 1;
  metadata: JournalMetadata;
  actions: JournalAction[];
};

export class LiveEvidenceError extends Error {}

function fail(message: string): never {
  throw new LiveEvidenceError(message);
}

export function safeFailureMessage(error: unknown): string {
  return error instanceof LiveEvidenceError
    ? error.message
    : "Live evidence stopped without disclosing an internal error.";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function requiredAddress(name: string): string {
  try {
    return getAddress(requiredEnv(name));
  } catch {
    fail(`${name} must be a valid Ethereum address.`);
  }
}

export function parsePaymentAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) fail("PAYROLL_LIVE_PAYMENT_AMOUNT must be an unsigned integer.");
  const amount = BigInt(value);
  if (amount === 0n || amount > FAUCET_CAP / BigInt(RECIPIENT_COUNT)) {
    fail("PAYROLL_LIVE_PAYMENT_AMOUNT is outside the permitted demo range.");
  }
  return amount;
}

function parseOperatorSeconds(value: string): number {
  if (!/^\d+$/.test(value)) fail("PAYROLL_LIVE_OPERATOR_SECONDS must be an integer.");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < MIN_OPERATOR_SECONDS || seconds > MAX_OPERATOR_SECONDS) {
    fail("PAYROLL_LIVE_OPERATOR_SECONDS must be a short lifetime between 900 and 3600 seconds.");
  }
  return seconds;
}

function walletFromSecret(name: string, secret: string, provider: JsonRpcProvider): Wallet {
  if (!/^0x[\da-fA-F]{64}$/.test(secret)) fail(`${name} must be a 32-byte hexadecimal private key.`);
  return new Wallet(secret, provider);
}

function defaultAccountAddresses(): Set<string> {
  return new Set(
    Array.from({ length: 20 }, (_, index) =>
      HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).address.toLowerCase(),
    ),
  );
}

function parseDemoWallets(provider: JsonRpcProvider, deploymentSigner: string): DemoWallets {
  const sender = walletFromSecret(
    "PAYROLL_LIVE_SENDER_PRIVATE_KEY",
    requiredEnv("PAYROLL_LIVE_SENDER_PRIVATE_KEY"),
    provider,
  );
  const recipientSecrets = requiredEnv("PAYROLL_LIVE_RECIPIENT_PRIVATE_KEYS").split(",");
  if (recipientSecrets.length !== RECIPIENT_COUNT || recipientSecrets.some((secret) => !secret.trim())) {
    fail("PAYROLL_LIVE_RECIPIENT_PRIVATE_KEYS must contain exactly ten comma-separated private keys.");
  }
  const recipients = recipientSecrets.map((secret, index) =>
    walletFromSecret(`PAYROLL_LIVE_RECIPIENT_PRIVATE_KEYS entry ${index + 1}`, secret.trim(), provider),
  );
  const outsider = walletFromSecret(
    "PAYROLL_LIVE_OUTSIDER_PRIVATE_KEY",
    requiredEnv("PAYROLL_LIVE_OUTSIDER_PRIVATE_KEY"),
    provider,
  );
  const addresses = [sender, ...recipients, outsider].map((wallet) => wallet.address.toLowerCase());
  if (new Set(addresses).size !== RECIPIENT_COUNT + 2)
    fail("Demo sender, recipients, and outsider must be distinct wallets.");
  if (addresses.includes(deploymentSigner.toLowerCase())) {
    fail("The deployment signer cannot be used for the live payroll demo.");
  }
  const defaults = defaultAccountAddresses();
  if (addresses.some((address) => defaults.has(address)))
    fail("Hardhat default accounts cannot be used for the live payroll demo.");
  return { sender, recipients, outsider };
}

export function createJournal(path: string, metadata: JournalMetadata): Journal {
  const journalPath = resolve(path);
  if (existsSync(journalPath)) fail("PAYROLL_LIVE_JOURNAL already exists. Inspect it before any new live run.");
  if (!existsSync(dirname(journalPath)) || !statSync(dirname(journalPath)).isDirectory()) {
    fail("PAYROLL_LIVE_JOURNAL must be inside an existing directory.");
  }
  const journal: Journal = { version: 1, metadata, actions: [] };
  writeFileSync(journalPath, JSON.stringify(journal), { encoding: "utf8", mode: 0o600, flag: "wx" });
  return journal;
}

function persistJournal(path: string, journal: Journal) {
  writeFileSync(path, JSON.stringify(journal), { encoding: "utf8", mode: 0o600 });
}

type SubmittedTransaction = {
  receipt: TransactionReceipt;
  action: JournalAction;
};

async function submitAndWait(
  journalPath: string,
  journal: Journal,
  name: string,
  submit: () => Promise<ContractTransactionResponse>,
): Promise<SubmittedTransaction> {
  const action: JournalAction = { name, status: "pending" };
  journal.actions.push(action);
  persistJournal(journalPath, journal);
  const transaction = await submit();
  action.status = "submitted";
  action.hash = transaction.hash;
  persistJournal(journalPath, journal);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) fail(`${name} did not confirm successfully.`);
  action.status = "confirmed";
  action.blockNumber = receipt.blockNumber;
  action.gasUsed = receipt.gasUsed.toString();
  persistJournal(journalPath, journal);
  console.log(`${name}: pass (${transaction.hash}, gas ${receipt.gasUsed})`);
  return { receipt, action };
}

function paymentLogs(
  receipt: TransactionReceipt,
  multisend: Contract,
  sender: string,
  token: string,
  recipients: Wallet[],
) {
  const logs = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== multisend.target.toString().toLowerCase()) return [];
    try {
      const parsed = multisend.interface.parseLog(log);
      return parsed?.name === "Payment" ? [{ args: parsed.args, index: log.index }] : [];
    } catch {
      return [];
    }
  });
  if (logs.length !== recipients.length) fail("The multisend receipt did not contain the expected payment evidence.");
  for (const [index, log] of logs.entries()) {
    if (
      log.args.sender.toLowerCase() !== sender.toLowerCase() ||
      log.args.token.toLowerCase() !== token.toLowerCase() ||
      log.args.recipient.toLowerCase() !== recipients[index].address.toLowerCase()
    ) {
      fail("The public payment log does not match the submitted batch.");
    }
  }
  return logs;
}

async function liveDecrypt(
  fhevm: FhevmInstance,
  wallet: Wallet,
  pairs: HandleContractPair[],
  contractAddresses: string[],
): Promise<Map<string, bigint>> {
  const keypair = fhevm.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const request = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const { EIP712Domain: _domain, ...types } = request.types;
  const signature = await wallet.signTypedData(
    request.domain,
    types as unknown as Record<string, { name: string; type: string }[]>,
    request.message,
  );
  const results = await fhevm.userDecrypt(
    pairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    wallet.address,
    startTimestamp,
    durationDays,
  );
  return new Map(
    pairs.map((pair) => [
      pair.handle.toString().toLowerCase(),
      BigInt(results[pair.handle.toString() as `0x${string}`]),
    ]),
  );
}

function privateValues(result: Map<string, bigint>, pairs: HandleContractPair[]): bigint[] {
  return pairs.map((pair) => {
    const value = result.get(pair.handle.toString().toLowerCase());
    if (value === undefined) fail("The relayer response omitted a requested private value.");
    return value;
  });
}

export function isAclAccessDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ACLUserDecryptionError";
}

async function requireAccessDenied(acl: ACL, wallet: Wallet, pair: HandleContractPair) {
  try {
    await acl.checkUserAllowedForDecryption({
      userAddress: wallet.address as `0x${string}`,
      handleContractPairs: {
        handle: pair.handle as `0x${string}`,
        contractAddress: pair.contractAddress as `0x${string}`,
      },
    });
  } catch (error) {
    if (isAclAccessDenied(error)) return;
    fail("An access-denial check failed for a reason other than ACL denial.");
  }
  fail("An unauthorized wallet was allowed to decrypt a private payment value.");
}

export function verifyRequestedAndActual(values: bigint[], expectedAmounts: bigint[], requireZeroActual: boolean) {
  if (values.length !== expectedAmounts.length * 2) fail("The relayer response has an unexpected payment value count.");
  for (let index = 0; index < expectedAmounts.length; index++) {
    const requested = values[index * 2];
    const actual = values[index * 2 + 1];
    if (requested !== expectedAmounts[index] || (requireZeroActual ? actual !== 0n : actual !== requested)) {
      fail("Private requested and actual payment evidence did not match the expected result.");
    }
  }
}

async function verifyPrivateEvidence(
  fhevm: FhevmInstance,
  provider: JsonRpcProvider,
  wallets: DemoWallets,
  multisendAddress: string,
  entries: ReturnType<typeof paymentLogs>,
  expectedAmounts: bigint[],
  requireZeroActual: boolean,
  journalPath: string,
  journal: Journal,
  action: JournalAction,
) {
  if (entries.length !== expectedAmounts.length) fail("The multisend emitted an unexpected number of payment logs.");
  const pairs = entries.flatMap((entry) => [
    { handle: entry.args.requestedAmount.toString(), contractAddress: multisendAddress },
    { handle: entry.args.actualAmount.toString(), contractAddress: multisendAddress },
  ]);
  const senderValues = privateValues(await liveDecrypt(fhevm, wallets.sender, pairs, [multisendAddress]), pairs);
  verifyRequestedAndActual(senderValues, expectedAmounts, requireZeroActual);
  for (let index = 0; index < entries.length; index++) {
    const ownPairs = pairs.slice(index * 2, index * 2 + 2);
    const recipientValues = privateValues(
      await liveDecrypt(fhevm, wallets.recipients[index], ownPairs, [multisendAddress]),
      ownPairs,
    );
    if (recipientValues[0] !== senderValues[index * 2] || recipientValues[1] !== senderValues[index * 2 + 1]) {
      fail("A recipient private read did not match the sender private read.");
    }
  }
  const acl = new ACL({
    aclContractAddress: fhevm.config.aclContractAddress,
    provider,
  });
  for (const pair of pairs.slice(0, 2)) await requireAccessDenied(acl, wallets.outsider, pair);
  for (const pair of pairs.slice(2, 4)) await requireAccessDenied(acl, wallets.recipients[0], pair);
  action.paymentLogIndexes = entries.map((entry) => entry.index);
  action.verification = "pass";
  persistJournal(journalPath, journal);
  console.log("private requested/actual evidence and access controls: pass");
}

async function assertInitialBalanceIsZero(fhevm: FhevmInstance, token: Contract, sender: Wallet, tokenAddress: string) {
  const handle = await token.confidentialBalanceOf(sender.address);
  if (handle === ZeroHash) return;
  const pair = { handle: handle.toString(), contractAddress: tokenAddress };
  const [balance] = privateValues(await liveDecrypt(fhevm, sender, [pair], [tokenAddress]), [pair]);
  if (balance !== 0n) fail("The dedicated demo sender must start with a zero private cUSDT balance.");
}

function artifactRuntimeBytecode(path: string): string {
  try {
    const deployedBytecode = JSON.parse(readFileSync(resolve(path), "utf8")).deployedBytecode;
    if (typeof deployedBytecode !== "string" || deployedBytecode === "0x") throw new Error();
    return deployedBytecode;
  } catch {
    fail("Compile the payroll contracts before running live evidence.");
  }
}

async function verifyRuntimeBytecode(provider: JsonRpcProvider, address: string, artifactPath: string, label: string) {
  const deployedCode = await provider.getCode(address);
  if (deployedCode === "0x" || keccak256(deployedCode) !== keccak256(artifactRuntimeBytecode(artifactPath))) {
    fail(`${label} does not match the compiled runtime bytecode.`);
  }
}

async function main() {
  dotenv.config({ quiet: true });
  if (requiredEnv("PAYROLL_LIVE_EVIDENCE") !== CONSENT) {
    fail("PAYROLL_LIVE_EVIDENCE does not contain the required transaction consent.");
  }
  const rpcUrl = requiredEnv("PAYROLL_LIVE_RPC_URL");
  const multisendAddress = requiredAddress("PAYROLL_LIVE_MULTISEND_ADDRESS");
  const deploymentSigner = requiredAddress("EXPECTED_DEPLOYER_ADDRESS");
  const journalPath = resolve(requiredEnv("PAYROLL_LIVE_JOURNAL"));
  const paymentAmount = parsePaymentAmount(requiredEnv("PAYROLL_LIVE_PAYMENT_AMOUNT"));
  const operatorSeconds = parseOperatorSeconds(requiredEnv("PAYROLL_LIVE_OPERATOR_SECONDS"));
  const provider = new JsonRpcProvider(rpcUrl);
  const wallets = parseDemoWallets(provider, deploymentSigner);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) fail("PAYROLL_LIVE_RPC_URL must connect to Sepolia.");
  if ((await provider.getBalance(wallets.sender.address)) === 0n)
    fail("The dedicated demo sender needs Sepolia ETH for transactions.");
  await verifyRuntimeBytecode(
    provider,
    multisendAddress,
    "artifacts/contracts/payroll/ConfidentialMultisend.sol/ConfidentialMultisend.json",
    "PAYROLL_LIVE_MULTISEND_ADDRESS",
  );
  await verifyRuntimeBytecode(
    provider,
    CUSDT_ADDRESS,
    "artifacts/contracts/mocks/ConfidentialGovToken.sol/ConfidentialGovToken.json",
    "The configured Sepolia cUSDT mock",
  );
  const token = new Contract(CUSDT_ADDRESS, tokenAbi, wallets.sender);
  const multisend = new Contract(multisendAddress, multisendAbi, wallets.sender);
  if ((await token.FAUCET_CAP()) !== FAUCET_CAP) {
    fail("The configured Sepolia cUSDT mock has an unexpected faucet cap.");
  }
  const fhevm = await createInstance({ ...SepoliaConfig, network: rpcUrl });
  await assertInitialBalanceIsZero(fhevm, token, wallets.sender, CUSDT_ADDRESS);
  const underfundedAmounts = Array<bigint>(RECIPIENT_COUNT).fill(FAUCET_CAP);
  const fundedAmounts = Array<bigint>(RECIPIENT_COUNT).fill(paymentAmount);
  const encrypt = async (amounts: bigint[]) => {
    const input = fhevm.createEncryptedInput(multisendAddress, wallets.sender.address);
    for (const amount of amounts) input.add64(amount);
    return input.encrypt();
  };
  const underfundedInput = await encrypt(underfundedAmounts);
  const fundedInput = await encrypt(fundedAmounts);
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) fail("The Sepolia head block is unavailable.");
  const operatorUntil = latestBlock.timestamp + operatorSeconds;
  const journal = createJournal(journalPath, {
    chainId: SEPOLIA_CHAIN_ID.toString(),
    token: CUSDT_ADDRESS,
    multisend: multisendAddress,
    sender: wallets.sender.address,
    recipients: wallets.recipients.map((recipient) => recipient.address),
  });
  const totalFunding = paymentAmount * BigInt(RECIPIENT_COUNT);
  let operatorGranted = false;
  try {
    await submitAndWait(journalPath, journal, "operator permission", () =>
      token.setOperator(multisendAddress, operatorUntil),
    );
    operatorGranted = true;
    const underfundedTransaction = await submitAndWait(journalPath, journal, "underfunded submission", () =>
      multisend.multisend(
        CUSDT_ADDRESS,
        wallets.recipients.map((recipient) => recipient.address),
        underfundedInput.handles,
        underfundedInput.inputProof,
      ),
    );
    await verifyPrivateEvidence(
      fhevm,
      provider,
      wallets,
      multisendAddress,
      paymentLogs(underfundedTransaction.receipt, multisend, wallets.sender.address, CUSDT_ADDRESS, wallets.recipients),
      underfundedAmounts,
      true,
      journalPath,
      journal,
      underfundedTransaction.action,
    );
    await submitAndWait(journalPath, journal, "faucet funding", () => token.faucet(totalFunding));
    const fundedTransaction = await submitAndWait(journalPath, journal, "funded ten-recipient submission", () =>
      multisend.multisend(
        CUSDT_ADDRESS,
        wallets.recipients.map((recipient) => recipient.address),
        fundedInput.handles,
        fundedInput.inputProof,
      ),
    );
    await verifyPrivateEvidence(
      fhevm,
      provider,
      wallets,
      multisendAddress,
      paymentLogs(fundedTransaction.receipt, multisend, wallets.sender.address, CUSDT_ADDRESS, wallets.recipients),
      fundedAmounts,
      false,
      journalPath,
      journal,
      fundedTransaction.action,
    );
  } finally {
    if (operatorGranted) {
      await submitAndWait(journalPath, journal, "operator revocation", () => token.setOperator(multisendAddress, 0));
    }
  }
  console.log(
    "Live evidence completed. Private amount comparisons and balances are not public evidence; uniform demo amounts can be inferred from public faucet funding.",
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  });
}
