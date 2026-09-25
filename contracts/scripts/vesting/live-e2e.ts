import {
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
  type HandleContractPair,
} from "@zama-fhe/relayer-sdk/node";
import {
  Contract,
  type ContractTransactionResponse,
  JsonRpcProvider,
  type TransactionReceipt,
  Wallet,
  ZeroHash,
} from "ethers";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const VESTING_ADDRESS = "0xD75E947e4262627E8fbE009585206F461afFA4b1";
const CUSDT_ADDRESS = "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA";
const ALLOCATION = 1_000_000n;
const FAUCET_CAP = 10_000n * 10n ** 6n;
const CONSENT = "I_AUTHORIZE_SEPOLIA_VESTING_E2E_TRANSACTIONS";

const tokenAbi = [
  "function FAUCET_CAP() view returns (uint64)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function faucet(uint64 amount)",
  "function setOperator(address operator, uint48 until)",
] as const;
const vestingAbi = [
  "function createGrant(address recipient, address token, uint48 start, uint48 end, uint48 cliff, bool revocable, bytes32 amount, bytes inputProof) returns (uint256)",
  "function revoke(uint256 grantId)",
  "function getGrant(uint256 grantId) view returns ((address treasury,address recipient,address token,uint48 start,uint48 end,uint48 cliff,bool revocable,bool revoked,uint256 revokedAt,bytes32 refundEntitlement,bytes32 refunded,bytes32 allocation,bytes32 claimed))",
  "event GrantCreated(uint256 indexed grantId, address indexed treasury, address indexed recipient, address token)",
] as const;

type DecryptingWallet = Pick<Wallet, "address" | "signTypedData">;
type Grant = {
  treasury: string;
  recipient: string;
  token: string;
  start: bigint;
  end: bigint;
  cliff: bigint;
  revocable: boolean;
  revoked: boolean;
  allocation: string;
  refunded: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function privateKey(): string {
  const value = requiredEnv("VESTING_LIVE_TREASURY_PRIVATE_KEY");
  if (!/^0x[\da-fA-F]{64}$/.test(value)) {
    throw new Error("VESTING_LIVE_TREASURY_PRIVATE_KEY must be a 32-byte hexadecimal private key.");
  }
  return value;
}

async function decrypt(
  fhevm: FhevmInstance,
  wallet: DecryptingWallet,
  pairs: HandleContractPair[],
  contractAddresses: string[],
): Promise<Map<string, bigint>> {
  const keypair = fhevm.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1_000);
  const durationDays = 1;
  const request = fhevm.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );
  const { EIP712Domain: _domain, ...types } = request.types;
  const signature = await wallet.signTypedData(
    request.domain,
    types as unknown as Record<string, { name: string; type: string }[]>,
    request.message,
  );
  const result = await fhevm.userDecrypt(
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
    pairs.map((pair) => {
      const value = result[pair.handle.toString() as `0x${string}`];
      if (typeof value !== "bigint") {
        throw new Error("The relayer returned an invalid decryption result.");
      }
      return [pair.handle.toString().toLowerCase(), value];
    }),
  );
}

function valueFor(values: Map<string, bigint>, pair: HandleContractPair): bigint {
  const value = values.get(pair.handle.toString().toLowerCase());
  if (value === undefined) throw new Error("The relayer omitted a requested private value.");
  return value;
}

function grantIdFromReceipt(receipt: TransactionReceipt, vesting: Contract): bigint {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VESTING_ADDRESS.toLowerCase()) continue;
    const parsed = vesting.interface.parseLog(log);
    if (parsed?.name === "GrantCreated") return parsed.args.grantId;
  }
  throw new Error("The create-grant receipt did not contain GrantCreated.");
}

function assertGrant(grant: Grant, treasury: DecryptingWallet, recipient: DecryptingWallet, start: bigint, end: bigint) {
  if (
    grant.treasury.toLowerCase() !== treasury.address.toLowerCase() ||
    grant.recipient.toLowerCase() !== recipient.address.toLowerCase() ||
    grant.token.toLowerCase() !== CUSDT_ADDRESS.toLowerCase() ||
    grant.start !== start ||
    grant.end !== end ||
    grant.cliff !== start ||
    !grant.revocable
  ) {
    throw new Error("The created grant does not match the requested immutable terms.");
  }
}

async function waitForSuccess(transaction: Promise<ContractTransactionResponse>): Promise<TransactionReceipt> {
  const receipt = await (await transaction).wait();
  if (!receipt || receipt.status !== 1) throw new Error("The Sepolia transaction did not succeed.");
  return receipt;
}

async function main() {
  if (requiredEnv("VESTING_LIVE_E2E") !== CONSENT) {
    throw new Error("VESTING_LIVE_E2E does not contain the required transaction consent.");
  }

  const provider = new JsonRpcProvider(requiredEnv("VESTING_LIVE_RPC_URL"));
  const treasury = new Wallet(privateKey(), provider);
  const recipient = Wallet.createRandom();
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw new Error("VESTING_LIVE_RPC_URL must connect to Sepolia.");
  if ((await provider.getBalance(treasury.address)) === 0n) throw new Error("The treasury needs Sepolia ETH.");
  if ((await provider.getCode(VESTING_ADDRESS)) === "0x") throw new Error("The configured vesting contract has no code.");
  if ((await provider.getCode(CUSDT_ADDRESS)) === "0x") throw new Error("The configured cUSDT token has no code.");

  const fhevm = await createInstance({ ...SepoliaConfig, network: requiredEnv("VESTING_LIVE_RPC_URL") });
  const token = new Contract(CUSDT_ADDRESS, tokenAbi, treasury);
  const vesting = new Contract(VESTING_ADDRESS, vestingAbi, treasury);
  let balanceHandle = await token.confidentialBalanceOf(treasury.address);
  let balance = 0n;
  if (balanceHandle !== ZeroHash) {
    const balancePair = { handle: balanceHandle.toString(), contractAddress: CUSDT_ADDRESS };
    balance = valueFor(await decrypt(fhevm, treasury, [balancePair], [CUSDT_ADDRESS]), balancePair);
  }
  if (balance < ALLOCATION) {
    if ((await token.FAUCET_CAP()) !== FAUCET_CAP) throw new Error("The configured cUSDT token has an unexpected faucet cap.");
    await waitForSuccess(token.faucet(ALLOCATION));
    balanceHandle = await token.confidentialBalanceOf(treasury.address);
    if (balanceHandle === ZeroHash) throw new Error("The cUSDT faucet did not fund the treasury.");
    const balancePair = { handle: balanceHandle.toString(), contractAddress: CUSDT_ADDRESS };
    balance = valueFor(await decrypt(fhevm, treasury, [balancePair], [CUSDT_ADDRESS]), balancePair);
  }
  if (balance < ALLOCATION) throw new Error("The treasury has insufficient confidential cUSDT for the E2E grant.");

  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) throw new Error("The latest Sepolia block is unavailable.");
  const start = BigInt(latestBlock.timestamp + 300);
  const end = start + 86_400n;
  const operatorUntil = BigInt(latestBlock.timestamp + 900);
  const input = fhevm.createEncryptedInput(VESTING_ADDRESS, treasury.address);
  input.add64(ALLOCATION);
  const encrypted = await input.encrypt();
  let operatorGranted = false;
  let grantId: bigint | undefined;
  let allocationVerified = false;
  let refundVerified = false;

  try {
    await waitForSuccess(token.setOperator(VESTING_ADDRESS, operatorUntil));
    operatorGranted = true;
    const createReceipt = await waitForSuccess(
      vesting.createGrant(
        recipient.address,
        CUSDT_ADDRESS,
        start,
        end,
        start,
        true,
        encrypted.handles[0],
        encrypted.inputProof,
      ),
    );
    grantId = grantIdFromReceipt(createReceipt, vesting);
    const grant = (await vesting.getGrant(grantId)) as Grant;
    assertGrant(grant, treasury, recipient, start, end);

    const allocationPair = { handle: grant.allocation, contractAddress: VESTING_ADDRESS };
    const treasuryAllocation = valueFor(
      await decrypt(fhevm, treasury, [allocationPair], [VESTING_ADDRESS]),
      allocationPair,
    );
    const recipientAllocation = valueFor(
      await decrypt(fhevm, recipient, [allocationPair], [VESTING_ADDRESS]),
      allocationPair,
    );
    if (treasuryAllocation !== ALLOCATION || recipientAllocation !== ALLOCATION) {
      throw new Error("The grant allocation did not decrypt to the funded cUSDT value.");
    }
    allocationVerified = true;
    console.log(`Grant ${grantId} was created and privately verified as funded.`);
  } finally {
    if (grantId !== undefined) {
      await waitForSuccess(vesting.revoke(grantId));
      if (allocationVerified) {
        const grant = (await vesting.getGrant(grantId)) as Grant;
        const refundPair = { handle: grant.refunded, contractAddress: VESTING_ADDRESS };
        const refunded = valueFor(
          await decrypt(fhevm, treasury, [refundPair], [VESTING_ADDRESS]),
          refundPair,
        );
        refundVerified = refunded === ALLOCATION;
      }
    }
    if (operatorGranted) await waitForSuccess(token.setOperator(VESTING_ADDRESS, 0));
  }
  if (allocationVerified && !refundVerified) {
    throw new Error("The test grant refund was not privately verified.");
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Vesting E2E failed.");
  process.exitCode = 1;
});
